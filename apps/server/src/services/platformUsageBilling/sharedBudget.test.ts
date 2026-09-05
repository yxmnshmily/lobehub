// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type LobeChatDatabase,
  PlatformCreditAdminModel,
  PlatformCreditModel,
} from '@lobechat/database';
import { platformCreditAccounts, platformCreditEntries } from '@lobechat/database/schemas';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PGlite } from '../../../../../packages/database/node_modules/@electric-sql/pglite';
import type * as ModelPricingModule from './modelPricing';
import { PlatformUsageReservationService } from './reservation';
import {
  bindPlatformUsageSharedBudget,
  completePlatformUsageSharedBudgetForOperation,
  createPlatformUsageSharedBudget,
  createSponsoredPlatformUsageSharedBudget,
  getPlatformUsageSharedBudgetForOperation,
  getPlatformUsageSharedBudgetLimit,
  hashPlatformUsageProviderInput,
  inheritPlatformUsageSharedBudget,
  PlatformUsageSharedBudgetError,
  runPlatformUsageSharedBudgetStep,
} from './sharedBudget';

const actorUserId = 'shared-budget-user';
const adminId = 'shared-budget-admin';
const sponsoredMemberUserId = 'shared-budget-sponsored-member';
const sponsoredOwnerUserId = 'shared-budget-sponsored-owner';
const sponsoredGroupId = 'shared-budget-sponsored-group';
const bindingContext = { actorUserId, workspaceId: 'workspace-a' };

let client: PGlite;
let db: LobeChatDatabase;
let ledger: PlatformCreditModel;

const pricingMocks = vi.hoisted(() => ({
  resolvePlatformModelPricing: vi.fn(),
}));

vi.mock('./modelPricing', async (importOriginal) => ({
  ...(await importOriginal<typeof ModelPricingModule>()),
  resolvePlatformModelPricing: pricingMocks.resolvePlatformModelPricing,
}));

const migrationPaths = [
  path.join(
    __dirname,
    '../../../../../packages/database/migrations/0156_platform_credit_ledger.sql',
  ),
  path.join(
    __dirname,
    '../../../../../packages/database/migrations/0161_platform_credit_reservations.sql',
  ),
  path.join(
    __dirname,
    '../../../../../packages/database/migrations/0162_platform_credit_sponsored_membership_purchase.sql',
  ),
  path.join(
    __dirname,
    '../../../../../packages/database/migrations/0163_group_sponsored_default_member_template.sql',
  ),
];

const applyMigration = async (database: PGlite, migrationPath: string) => {
  const statements = readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await database.exec(statement);
};

const createRoot = () =>
  createPlatformUsageSharedBudget(db, actorUserId, {
    expiresAt: new Date(Date.now() + 60_000),
    maxCredits: 100,
    requestIdentity: 'request-identity-do-not-serialize',
    workspaceId: 'workspace-a',
  });

beforeEach(async () => {
  pricingMocks.resolvePlatformModelPricing.mockResolvedValue({
    model: 'model-a',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    provider: 'provider-a',
  });
  client = new PGlite();
  db = drizzle(client) as unknown as LobeChatDatabase;
  await client.exec(`
    CREATE TABLE users (id text PRIMARY KEY, banned boolean DEFAULT false);
    CREATE TABLE chat_groups (
      id text PRIMARY KEY,
      client_id text,
      user_id text,
      visibility text,
      workspace_id text
    );
    INSERT INTO users (id) VALUES
      ('${actorUserId}'),
      ('${adminId}'),
      ('${sponsoredMemberUserId}'),
      ('${sponsoredOwnerUserId}');
  `);
  for (const migrationPath of migrationPaths) await applyMigration(client, migrationPath);
  await new PlatformCreditAdminModel(db, adminId).topUp({
    credits: 100,
    idempotencyKey: 'top-up:shared-budget-user',
    reason: 'shared budget tests',
    targetUserId: actorUserId,
  });
  ledger = new PlatformCreditModel(db, actorUserId);
});

describe('platform-managed shared request budget', () => {
  it('creates a real sponsored handle that settles only the owner account', async () => {
    await new PlatformCreditAdminModel(db, adminId).topUp({
      credits: 100,
      idempotencyKey: 'top-up:shared-budget-sponsored-owner',
      reason: 'sponsored shared budget tests',
      targetUserId: sponsoredOwnerUserId,
    });
    const ownerAccount = await new PlatformCreditModel(db, sponsoredOwnerUserId).getAccount();
    const now = new Date();
    const periodEndsAt = new Date(now.getTime() + 60_000);
    await client.query(
      `INSERT INTO chat_groups (id, client_id, user_id, visibility, workspace_id)
       VALUES ($1, 'default-travel-service-group', $2, 'private', NULL)`,
      [sponsoredGroupId, sponsoredOwnerUserId],
    );
    await client.query(
      `INSERT INTO chat_group_user_memberships
       (chat_group_id, user_id, invited_by_user_id, role, can_use_paid_ai,
        max_credits_per_request, max_credits_per_period, membership_version)
       VALUES ($1, $2, $3, 'member', true, 100, 100, 2)`,
      [sponsoredGroupId, sponsoredMemberUserId, sponsoredOwnerUserId],
    );
    await client.query(
      `INSERT INTO chat_group_sponsored_credit_policies
       (chat_group_id, payer_account_id, payer_user_id, payer_user_id_snapshot, enabled,
        group_period_limit_credits, period_started_at, period_ends_at,
        period_duration_seconds, policy_version)
       VALUES ($1, $2, $3, $3, true, 100, $4, $5, 60, 1)`,
      [sponsoredGroupId, ownerAccount.id, sponsoredOwnerUserId, now, periodEndsAt],
    );

    const handle = await createSponsoredPlatformUsageSharedBudget(db, sponsoredMemberUserId, {
      chatGroupId: sponsoredGroupId,
      expectedMembershipVersion: 2,
      expectedPolicyVersion: 1,
      expiresAt: new Date(Date.now() + 30_000),
      maxCredits: 100,
      requestIdentity: 'sponsored-request-identity',
    });
    const operationId = 'sponsored-operation';
    bindPlatformUsageSharedBudget(operationId, handle, {
      actorUserId: sponsoredMemberUserId,
      workspaceId: null,
    });

    await expect(
      runPlatformUsageSharedBudgetStep(handle, {
        actorUserId: sponsoredMemberUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['owner sponsored'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId,
        provider: 'provider-a',
        providerCall: vi.fn().mockResolvedValue({
          output: 'sponsored output',
          providerRequestId: 'sponsored-provider-request',
          usage: {
            cost: 999,
            totalInputTokens: 10,
            totalOutputTokens: 5,
            totalTokens: 15,
          },
        }),
        stepIndex: 0,
        workspaceId: null,
      }),
    ).resolves.toBe('sponsored output');
    await expect(completePlatformUsageSharedBudgetForOperation(operationId)).resolves.toBe(true);

    const [settledOwnerAccount] = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.id, ownerAccount.id));
    const actorAccounts = await db
      .select()
      .from(platformCreditAccounts)
      .where(eq(platformCreditAccounts.userIdSnapshot, sponsoredMemberUserId));
    const [entry] = await db
      .select()
      .from(platformCreditEntries)
      .where(
        and(
          eq(platformCreditEntries.userIdSnapshot, sponsoredOwnerUserId),
          eq(platformCreditEntries.type, 'usage_charge'),
        ),
      );
    expect(settledOwnerAccount.balanceCredits).toBe(80);
    expect(actorAccounts).toHaveLength(0);
    expect(entry).toMatchObject({
      actorUserIdSnapshot: sponsoredMemberUserId,
      amountCredits: -20,
      userIdSnapshot: sponsoredOwnerUserId,
    });
  });

  it('uses the server catalog snapshot and replaces a mismatched runtime cost', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('catalog-priced-operation', budget, bindingContext);

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['priced by server'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId: 'catalog-priced-operation',
        provider: 'provider-a',
        providerCall: vi.fn().mockResolvedValue({
          output: 'priced output',
          usage: {
            cost: 999,
            totalInputTokens: 10,
            totalOutputTokens: 5,
            totalTokens: 15,
          },
        }),
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe('priced output');

    expect(pricingMocks.resolvePlatformModelPricing).toHaveBeenCalledWith(db, {
      model: 'model-a',
      provider: 'provider-a',
    });
    await expect(
      completePlatformUsageSharedBudgetForOperation('catalog-priced-operation'),
    ).resolves.toBe(true);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 80,
      balanceCredits: 80,
      heldCredits: 0,
    });
  });

  it.each([
    ['missing', undefined],
    ['unavailable', new Error('model catalog unavailable')],
  ])(
    'fails closed before reserving or calling the provider when exact pricing is %s',
    async (pricingCase, pricingResult) => {
      const budget = await createRoot();
      const operationId = `pricing-operation-${pricingCase}`;
      bindPlatformUsageSharedBudget(operationId, budget, bindingContext);
      const reserveRemainingCall = vi.spyOn(
        PlatformUsageReservationService.prototype,
        'reserveRemainingCall',
      );
      const providerCall = vi.fn().mockResolvedValue({ output: 'must not run' });
      if (pricingResult instanceof Error) {
        pricingMocks.resolvePlatformModelPricing.mockRejectedValueOnce(pricingResult);
      } else {
        pricingMocks.resolvePlatformModelPricing.mockResolvedValueOnce(pricingResult);
      }

      await expect(
        runPlatformUsageSharedBudgetStep(budget, {
          actorUserId,
          inputHash: hashPlatformUsageProviderInput({ messages: ['private prompt'] }),
          kind: 'call_llm',
          model: 'same-name-model',
          operationId,
          provider: 'unpriced-provider',
          providerCall,
          stepIndex: 0,
          workspaceId: 'workspace-a',
        }),
      ).rejects.toMatchObject({ code: 'MODEL_PRICING_UNAVAILABLE' });

      expect(pricingMocks.resolvePlatformModelPricing).toHaveBeenCalledWith(db, {
        model: 'same-name-model',
        provider: 'unpriced-provider',
      });
      expect(reserveRemainingCall).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
    },
  );

  it('keeps the root context opaque while sharing it with child operations in process', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('opaque-parent-operation', budget, bindingContext);
    inheritPlatformUsageSharedBudget(
      'opaque-parent-operation',
      'opaque-member-operation',
      bindingContext,
    );

    expect(
      getPlatformUsageSharedBudgetForOperation('opaque-member-operation', bindingContext),
    ).toBe(budget);
    expect(JSON.stringify(budget)).toBe('{}');
    expect(JSON.stringify({ budget })).toBe('{"budget":{}}');
    expect(
      JSON.stringify(getPlatformUsageSharedBudgetForOperation('missing', bindingContext)),
    ).toBeUndefined();
    expect(getPlatformUsageSharedBudgetLimit(budget, bindingContext)).toBe(100);
    expect(() =>
      getPlatformUsageSharedBudgetLimit(budget, {
        actorUserId: 'another-user',
        workspaceId: 'workspace-a',
      }),
    ).toThrowError(PlatformUsageSharedBudgetError);
  });

  it('fails closed when an operation is unbound or belongs to another actor or workspace', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('bound-operation', budget, bindingContext);
    const providerCall = vi.fn().mockResolvedValue({ output: 'must not run' });
    const baseStep = {
      actorUserId,
      inputHash: hashPlatformUsageProviderInput({ messages: ['private prompt'] }),
      kind: 'call_llm' as const,
      model: 'model-a',
      provider: 'provider-a',
      providerCall,
      stepIndex: 0,
      workspaceId: 'workspace-a',
    };

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        ...baseStep,
        operationId: 'unbound-operation',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET_CONTEXT' });
    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        ...baseStep,
        actorUserId: 'another-user',
        operationId: 'bound-operation',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET_CONTEXT' });
    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        ...baseStep,
        operationId: 'bound-operation',
        workspaceId: 'workspace-b',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BUDGET_CONTEXT' });

    expect(
      getPlatformUsageSharedBudgetForOperation('bound-operation', {
        actorUserId: 'another-user',
        workspaceId: 'workspace-a',
      }),
    ).toBeUndefined();
    expect(
      getPlatformUsageSharedBudgetForOperation('bound-operation', {
        actorUserId,
        workspaceId: 'workspace-b',
      }),
    ).toBeUndefined();
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('reserves the remaining request budget before each provider call and settles authoritative usage', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('settled-parent-operation', budget, bindingContext);
    bindPlatformUsageSharedBudget('settled-member-operation', budget, bindingContext);
    const providerCall = vi
      .fn()
      .mockResolvedValueOnce({
        output: 'first',
        usage: { cost: 0.00003, totalInputTokens: 30, totalOutputTokens: 0, totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        output: 'second',
        usage: { cost: 0.00007, totalInputTokens: 70, totalOutputTokens: 0, totalTokens: 70 },
      });

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['first prompt'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId: 'settled-parent-operation',
        provider: 'provider-a',
        providerCall,
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe('first');
    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['compressed context'] }),
        kind: 'compress_context',
        model: 'model-a',
        operationId: 'settled-member-operation',
        provider: 'provider-a',
        providerCall,
        stepIndex: 1,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe('second');

    expect(providerCall).toHaveBeenCalledTimes(2);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 0,
      balanceCredits: 0,
      heldCredits: 0,
    });
  });

  it('passes only the authoritative reservation remainder into bounded provider preparation', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('first-bounded-operation', budget, bindingContext);
    bindPlatformUsageSharedBudget('second-bounded-operation', budget, bindingContext);
    await runPlatformUsageSharedBudgetStep(budget, {
      actorUserId,
      inputHash: hashPlatformUsageProviderInput({ messages: ['first prompt'] }),
      kind: 'call_llm',
      model: 'model-a',
      operationId: 'first-bounded-operation',
      provider: 'provider-a',
      providerCall: vi.fn().mockResolvedValue({
        output: 'first',
        usage: { cost: 999, totalInputTokens: 30, totalOutputTokens: 0, totalTokens: 30 },
      }),
      stepIndex: 0,
      workspaceId: 'workspace-a',
    });
    const boundedProviderCall = vi.fn().mockResolvedValue({
      output: 'second',
      usage: { cost: 999, totalInputTokens: 10, totalOutputTokens: 10, totalTokens: 20 },
    });
    const prepareProviderCall = vi.fn().mockResolvedValue(boundedProviderCall);

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['second prompt'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId: 'second-bounded-operation',
        prepareProviderCall,
        provider: 'provider-a',
        stepIndex: 1,
        workspaceId: 'workspace-a',
      }),
    ).resolves.toBe('second');

    expect(prepareProviderCall).toHaveBeenCalledWith({
      pricing: expect.objectContaining({ model: 'model-a', provider: 'provider-a' }),
      remainingCredits: 70,
    });
    expect(boundedProviderCall).toHaveBeenCalledOnce();
  });

  it('does not claim or execute the provider when bounded preparation fails', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('unavailable-bounded-operation', budget, bindingContext);
    const boundedProviderCall = vi.fn();
    const prepareProviderCall = vi
      .fn()
      .mockRejectedValue(new Error('Platform bounded text generation is unavailable'));

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['must stay closed'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId: 'unavailable-bounded-operation',
        prepareProviderCall,
        provider: 'provider-a',
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }),
    ).rejects.toThrow('Platform bounded text generation is unavailable');

    expect(prepareProviderCall).toHaveBeenCalledWith({
      pricing: expect.objectContaining({ model: 'model-a', provider: 'provider-a' }),
      remainingCredits: 100,
    });
    expect(boundedProviderCall).not.toHaveBeenCalled();
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 0,
      balanceCredits: 100,
      heldCredits: 100,
    });
  });

  it('does not re-call or release a provider_started reservation after an unknown provider outcome', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('unknown-parent-operation', budget, bindingContext);
    const providerCall = vi.fn().mockRejectedValue(new Error('raw provider secret'));
    const step = {
      actorUserId,
      inputHash: hashPlatformUsageProviderInput({ messages: ['private prompt'] }),
      kind: 'call_llm' as const,
      model: 'model-a',
      operationId: 'unknown-parent-operation',
      provider: 'provider-a',
      providerCall,
      stepIndex: 0,
      workspaceId: 'workspace-a',
    };

    await expect(runPlatformUsageSharedBudgetStep(budget, step)).rejects.toMatchObject({
      code: 'PROVIDER_OUTCOME_UNKNOWN',
      message: 'Platform usage provider outcome is unknown.',
    });
    await expect(runPlatformUsageSharedBudgetStep(budget, step)).rejects.toMatchObject({
      code: 'PROVIDER_ALREADY_CLAIMED',
    });

    expect(providerCall).toHaveBeenCalledTimes(1);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 0,
      balanceCredits: 100,
      heldCredits: 100,
    });
  });

  it('completes only after all bound operations finish and there are no active reservations', async () => {
    const budget = await createRoot();
    bindPlatformUsageSharedBudget('finish-parent-operation', budget, bindingContext);
    inheritPlatformUsageSharedBudget(
      'finish-parent-operation',
      'finish-member-operation',
      bindingContext,
    );

    await expect(
      completePlatformUsageSharedBudgetForOperation('finish-member-operation'),
    ).resolves.toBe(false);
    await expect(
      completePlatformUsageSharedBudgetForOperation('finish-parent-operation'),
    ).resolves.toBe(true);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 100,
      balanceCredits: 100,
      heldCredits: 0,
    });

    const activeBudget = await createPlatformUsageSharedBudget(db, actorUserId, {
      expiresAt: new Date(Date.now() + 60_000),
      maxCredits: 100,
      requestIdentity: 'request-with-active-provider',
      workspaceId: 'workspace-a',
    });
    bindPlatformUsageSharedBudget('active-operation', activeBudget, bindingContext);
    await expect(
      runPlatformUsageSharedBudgetStep(activeBudget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['private'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId: 'active-operation',
        provider: 'provider-a',
        providerCall: async () => {
          throw new Error('unknown');
        },
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }),
    ).rejects.toBeInstanceOf(PlatformUsageSharedBudgetError);
    await expect(completePlatformUsageSharedBudgetForOperation('active-operation')).resolves.toBe(
      false,
    );
  });
});
