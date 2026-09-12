// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type LobeChatDatabase,
  PlatformCreditAdminModel,
  PlatformCreditModel,
} from '@lobechat/database';
import {
  platformCreditAccounts,
  platformCreditEntries,
  platformCreditReservations,
} from '@lobechat/database/schemas';
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
  getPlatformUsageSharedBudgetSnapshot,
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

it('reserves and releases a server-policy budget without an explicit user amount', async () => {
  const budget = await createPlatformUsageSharedBudget(db, actorUserId, {
    expiresAt: new Date(Date.now() + 60_000),
    limitSource: 'server-policy',
    maxCredits: 80,
    requestIdentity: 'automatic-budget',
    workspaceId: 'workspace-a',
  });
  bindPlatformUsageSharedBudget('automatic-operation', budget, bindingContext);
  expect(await ledger.getAvailableCredits()).toMatchObject({
    availableCredits: 20,
    heldCredits: 80,
  });
  await completePlatformUsageSharedBudgetForOperation('automatic-operation');
  expect(await ledger.getAvailableCredits()).toMatchObject({
    availableCredits: 100,
    heldCredits: 0,
  });
});

it('holds only one metered model call and settles its actual usage', async () => {
  await new PlatformCreditAdminModel(db, adminId).topUp({
    credits: 100_000,
    idempotencyKey: 'top-up:metered-automatic-budget',
    reason: '按调用计费测试',
    targetUserId: actorUserId,
  });
  const budget = await createPlatformUsageSharedBudget(db, actorUserId, {
    expiresAt: new Date(Date.now() + 60_000),
    limitSource: 'server-policy',
    maxCredits: 80,
    meteredMaxCreditsPerCall: 30,
    requestIdentity: 'metered-automatic-budget',
    workspaceId: 'workspace-a',
  });
  bindPlatformUsageSharedBudget('metered-operation', budget, bindingContext);
  expect(await ledger.getAvailableCredits()).toMatchObject({
    availableCredits: 100_100,
    heldCredits: 0,
  });

  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const run = runPlatformUsageSharedBudgetStep(budget, {
    ...bindingContext,
    inputHash: 'metered-input',
    kind: 'call_llm',
    model: 'model-a',
    operationId: 'metered-operation',
    prepareProviderCall: async ({ remainingCredits }) => {
      expect(remainingCredits).toBe(30);
      return async () => {
        await providerGate;
        return {
          output: 'metered reply',
          usage: { cost: 1, totalInputTokens: 4, totalOutputTokens: 1, totalTokens: 5 },
        };
      };
    },
    provider: 'provider-a',
    stepIndex: 0,
  });

  await vi.waitFor(async () => {
    await expect(ledger.getAvailableCredits()).resolves.toMatchObject({
      availableCredits: 100_070,
      heldCredits: 30,
    });
  });
  releaseProvider();
  await expect(run).resolves.toBe('metered reply');
  await expect(ledger.getAvailableCredits()).resolves.toMatchObject({
    availableCredits: 100_094,
    balanceCredits: 100_094,
    heldCredits: 0,
  });
});

it('keeps valid prepaid holds ahead of metered automatic admission', async () => {
  await new PlatformCreditAdminModel(db, adminId).topUp({
    credits: 100_000,
    idempotencyKey: 'top-up:metered-with-prepaid-hold',
    reason: '并发预留测试',
    targetUserId: actorUserId,
  });
  await createPlatformUsageSharedBudget(db, actorUserId, {
    expiresAt: new Date(Date.now() + 60_000),
    maxCredits: 60_001,
    requestIdentity: 'valid-prepaid-budget',
    workspaceId: 'workspace-a',
  });

  await expect(
    createPlatformUsageSharedBudget(db, actorUserId, {
      expiresAt: new Date(Date.now() + 60_000),
      limitSource: 'server-policy',
      maxCredits: 80_000,
      meteredMaxCreditsPerCall: 30_000,
      requestIdentity: 'metered-after-prepaid-budget',
      workspaceId: 'workspace-a',
    }),
  ).rejects.toMatchObject({ code: 'RESERVATION_FAILED' });
});

it('rejects an unbounded provider callback even with a prepaid request ceiling', async () => {
  const budget = await createRoot();
  bindPlatformUsageSharedBudget('unbounded-call-rejected', budget, bindingContext);
  const providerCall = vi.fn().mockResolvedValue({ output: 'must not run' });
  await expect(
    runPlatformUsageSharedBudgetStep(budget, {
      ...bindingContext,
      inputHash: 'unbounded-input',
      kind: 'call_llm',
      model: 'model-a',
      operationId: 'unbounded-call-rejected',
      provider: 'provider-a',
      providerCall,
      stepIndex: 0,
    }),
  ).rejects.toMatchObject({ code: 'PROVIDER_LIMIT_UNPROVEN' });
  expect(providerCall).not.toHaveBeenCalled();
});

const seedSponsoredGroup = async (ownerCredits = 100) => {
  for (const [userId, credits] of [
    [sponsoredOwnerUserId, ownerCredits],
    [sponsoredMemberUserId, 100],
  ] as const) {
    if (credits > 0)
      await new PlatformCreditAdminModel(db, adminId).topUp({
        credits,
        idempotencyKey: `sponsored-boundary:${userId}`,
        reason: 'isolated sponsored group billing boundary',
        targetUserId: userId,
      });
  }
  await client.query(
    `INSERT INTO chat_groups (id,client_id,user_id,visibility,workspace_id)
     VALUES ($1,'default-travel-service-group',$2,'private',NULL)`,
    [sponsoredGroupId, sponsoredOwnerUserId],
  );
  await client.query(
    `INSERT INTO chat_group_user_memberships (chat_group_id,user_id,role,can_use_paid_ai,membership_version)
     VALUES ($1,$2,'member',false,2)`,
    [sponsoredGroupId, sponsoredMemberUserId],
  );
  return {
    chatGroupId: sponsoredGroupId,
    expectedMembershipVersion: 2,
    expiresAt: new Date(Date.now() + 30_000),
    maxCredits: 100,
    requestIdentity: 'sponsored-boundary-request',
  };
};

const seedAuthorizedSponsoredGroup = async () => {
  const input = await seedSponsoredGroup();
  const account = await new PlatformCreditModel(db, sponsoredOwnerUserId).getAccount();
  await client.query(
    `UPDATE chat_group_user_memberships SET can_use_paid_ai=true,
       max_credits_per_request=100,max_credits_per_period=100 WHERE chat_group_id=$1 AND user_id=$2`,
    [sponsoredGroupId, sponsoredMemberUserId],
  );
  const now = new Date();
  await client.query(
    `INSERT INTO chat_group_sponsored_credit_policies
       (chat_group_id,payer_account_id,payer_user_id,payer_user_id_snapshot,enabled,
        group_period_limit_credits,period_started_at,period_ends_at,period_duration_seconds,policy_version)
       VALUES ($1,$2,$3,$3,true,100,$4,$5,60,1)`,
    [sponsoredGroupId, account.id, sponsoredOwnerUserId, now, new Date(now.getTime() + 60_000)],
  );
  return { ...input, expectedPolicyVersion: 1 };
};

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

describe('durable shared budget continuation', () => {
  const persistOperation = async (operationId: string, snapshot: unknown, parent = false) => {
    await client.exec(`CREATE TABLE IF NOT EXISTS agent_operations (
      id text PRIMARY KEY, user_id text NOT NULL, workspace_id text,
      chat_group_id text, metadata jsonb, status text NOT NULL
    )`);
    await client.query('INSERT INTO agent_operations VALUES ($1, $2, $3, NULL, $4::jsonb, $5)', [
      operationId,
      actorUserId,
      'workspace-a',
      JSON.stringify({ platformUsageBudget: snapshot }),
      parent ? 'waiting' : 'running',
    ]);
  };

  it('restores the original reservation after a module reload without reserving again', async () => {
    const handle = await createRoot();
    bindPlatformUsageSharedBudget('durable-root', handle, bindingContext);
    const snapshot = getPlatformUsageSharedBudgetSnapshot('durable-root', bindingContext);
    await persistOperation('durable-root', snapshot);
    vi.resetModules();
    const fresh = await import('./sharedBudget');
    expect(
      fresh.getPlatformUsageSharedBudgetForOperation('durable-root', bindingContext),
    ).toBeUndefined();
    const restored = await fresh.restorePlatformUsageSharedBudgetForOperation(
      db,
      'durable-root',
      bindingContext,
    );
    expect(restored).toBeDefined();
    expect(fresh.getPlatformUsageSharedBudgetLimit(restored!, bindingContext)).toBe(100);
    expect(await ledger.getAvailableCredits()).toMatchObject({
      availableCredits: 0,
      heldCredits: 100,
    });
    expect((await client.query('SELECT count(*) FROM platform_credit_budgets')).rows[0]).toEqual({
      count: 1,
    });
    const providerCall = vi.fn().mockResolvedValue({
      output: 'continued',
      usage: { totalInputTokens: 1, totalOutputTokens: 1, totalTokens: 2 },
    });
    await expect(
      fresh.runPlatformUsageSharedBudgetStep(restored!, {
        ...bindingContext,
        operationId: 'durable-root',
        inputHash: 'continued-input',
        kind: 'call_llm',
        model: 'model-a',
        provider: 'provider-a',
        stepIndex: 1,
        prepareProviderCall: async () => providerCall,
      }),
    ).resolves.toBe('continued');
    expect(providerCall).toHaveBeenCalledOnce();
  });

  it.each(['actor', 'workspace', 'expired', 'closed', 'lease', 'owner'])(
    'rejects %s mismatches after a reload',
    async (scenario) => {
      const operationId = `durable-denied-${scenario}`;
      const handle = await createRoot();
      bindPlatformUsageSharedBudget(operationId, handle, bindingContext);
      await persistOperation(
        operationId,
        getPlatformUsageSharedBudgetSnapshot(operationId, bindingContext),
      );
      if (scenario === 'expired')
        await client.exec(
          "UPDATE platform_credit_budgets SET expires_at=now()-interval '1 minute'",
        );
      if (scenario === 'closed')
        await client.exec("UPDATE platform_credit_budgets SET status='settled'");
      if (scenario === 'lease')
        await client.exec('UPDATE platform_credit_budgets SET lease_version=lease_version+1');
      if (scenario === 'owner')
        await client.exec("UPDATE agent_operations SET user_id='someone-else'");
      vi.resetModules();
      const fresh = await import('./sharedBudget');
      await expect(
        fresh.restorePlatformUsageSharedBudgetForOperation(db, operationId, {
          ...bindingContext,
          ...(scenario === 'actor' ? { actorUserId: 'someone-else' } : {}),
          ...(scenario === 'workspace' ? { workspaceId: 'other-workspace' } : {}),
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BUDGET_CONTEXT' });
      expect(
        fresh.getPlatformUsageSharedBudgetForOperation(operationId, bindingContext),
      ).toBeUndefined();
    },
  );

  it('does not release a restored member budget while its parent is waiting in another worker', async () => {
    const handle = await createRoot();
    bindPlatformUsageSharedBudget('durable-parent', handle, bindingContext);
    inheritPlatformUsageSharedBudget('durable-parent', 'durable-child', bindingContext);
    const snapshot = getPlatformUsageSharedBudgetSnapshot('durable-parent', bindingContext);
    await persistOperation('durable-parent', snapshot, true);
    await persistOperation('durable-child', snapshot);
    vi.resetModules();
    const fresh = await import('./sharedBudget');
    await fresh.restorePlatformUsageSharedBudgetForOperation(db, 'durable-child', bindingContext);
    expect(await fresh.completePlatformUsageSharedBudgetForOperation('durable-child')).toBe(false);
    expect(await ledger.getAvailableCredits()).toMatchObject({ heldCredits: 100 });
    await client.exec("UPDATE agent_operations SET status='done' WHERE id='durable-child'");
    await fresh.restorePlatformUsageSharedBudgetForOperation(db, 'durable-parent', bindingContext);
    expect(await fresh.completePlatformUsageSharedBudgetForOperation('durable-parent')).toBe(true);
    expect(await ledger.getAvailableCredits()).toMatchObject({ heldCredits: 0 });
  });

  it('retries cleanup after two workers initially see each other as still running', async () => {
    const handle = await createRoot();
    bindPlatformUsageSharedBudget('concurrent-parent', handle, bindingContext);
    const snapshot = getPlatformUsageSharedBudgetSnapshot('concurrent-parent', bindingContext);
    await persistOperation('concurrent-parent', snapshot);
    await persistOperation('concurrent-child', snapshot);
    vi.resetModules();
    const parentWorker = await import('./sharedBudget');
    await parentWorker.restorePlatformUsageSharedBudgetForOperation(
      db,
      'concurrent-parent',
      bindingContext,
    );
    vi.resetModules();
    const childWorker = await import('./sharedBudget');
    await childWorker.restorePlatformUsageSharedBudgetForOperation(
      db,
      'concurrent-child',
      bindingContext,
    );
    expect(
      await Promise.all([
        parentWorker.completePlatformUsageSharedBudgetForOperation('concurrent-parent'),
        childWorker.completePlatformUsageSharedBudgetForOperation('concurrent-child'),
      ]),
    ).toEqual([false, false]);
    expect(await ledger.getAvailableCredits()).toMatchObject({ heldCredits: 100 });
    await client.exec("UPDATE agent_operations SET status='done'");
    expect(
      await parentWorker.completePlatformUsageSharedBudgetForOperation('concurrent-parent'),
    ).toBe(true);
    expect(await ledger.getAvailableCredits()).toMatchObject({ heldCredits: 0 });
  });

  it('uses durable completion instead of a stale local child binding in the original worker', async () => {
    const handle = await createRoot();
    bindPlatformUsageSharedBudget('original-worker-root', handle, bindingContext);
    inheritPlatformUsageSharedBudget('original-worker-root', 'remote-worker-child', bindingContext);
    const snapshot = getPlatformUsageSharedBudgetSnapshot('original-worker-root', bindingContext);
    await persistOperation('original-worker-root', snapshot);
    await persistOperation('remote-worker-child', snapshot);
    vi.resetModules();
    const childWorker = await import('./sharedBudget');
    await childWorker.restorePlatformUsageSharedBudgetForOperation(
      db,
      'remote-worker-child',
      bindingContext,
    );
    expect(
      await childWorker.completePlatformUsageSharedBudgetForOperation('remote-worker-child'),
    ).toBe(false);
    await client.exec("UPDATE agent_operations SET status='done' WHERE id='remote-worker-child'");
    expect(await completePlatformUsageSharedBudgetForOperation('original-worker-root')).toBe(true);
    expect(await ledger.getAvailableCredits()).toMatchObject({ heldCredits: 0 });
    expect(
      getPlatformUsageSharedBudgetForOperation('remote-worker-child', bindingContext),
    ).toBeUndefined();
  });
});

describe('platform-managed shared request budget', () => {
  it.each([
    ['missing policy', 'DELETE FROM chat_group_sponsored_credit_policies'],
    [
      'paid access disabled',
      'UPDATE chat_group_user_memberships SET can_use_paid_ai=false, max_credits_per_request=NULL, max_credits_per_period=NULL',
    ],
    ['request limit', 'UPDATE chat_group_user_memberships SET max_credits_per_request=99'],
    [
      'group period limit',
      'UPDATE chat_group_sponsored_credit_policies SET group_period_limit_credits=99',
    ],
    ['stale membership', 'UPDATE chat_group_user_memberships SET membership_version=3'],
    ['stale policy', 'UPDATE chat_group_sponsored_credit_policies SET policy_version=2'],
  ])(
    'rejects sponsored admission with %s without holding either account',
    async (_name, change) => {
      const input = await seedAuthorizedSponsoredGroup();
      await client.exec(change);
      await expect(
        createSponsoredPlatformUsageSharedBudget(db, sponsoredMemberUserId, input),
      ).rejects.toMatchObject({ code: 'RESERVATION_FAILED' });
      expect((await client.query('SELECT id FROM platform_credit_budgets')).rows).toEqual([]);
      for (const payerUserId of [sponsoredOwnerUserId, sponsoredMemberUserId]) {
        expect(await new PlatformCreditModel(db, payerUserId).getAvailableCredits()).toEqual({
          availableCredits: 100,
          balanceCredits: 100,
          heldCredits: 0,
        });
      }
    },
  );

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
    expect(
      (
        await client.query(
          'SELECT actor_user_id_snapshot, user_id_snapshot, authorization_kind FROM platform_credit_budgets',
        )
      ).rows,
    ).toEqual([
      {
        actor_user_id_snapshot: sponsoredMemberUserId,
        user_id_snapshot: sponsoredOwnerUserId,
        authorization_kind: 'group_member_sponsored',
      },
    ]);
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
        prepareProviderCall:
          async () =>
          async ({ recordProviderRequestId }) => {
            await recordProviderRequestId('sponsored-provider-request');
            return {
              output: 'sponsored output',
              providerRequestId: 'sponsored-provider-request',
              usage: {
                cost: 999,
                totalInputTokens: 10,
                totalOutputTokens: 5,
                totalTokens: 15,
              },
            };
          },
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
    const [reservation] = await db.select().from(platformCreditReservations);
    expect(settledOwnerAccount.balanceCredits).toBe(80);
    expect(actorAccounts).toHaveLength(0);
    expect(reservation).toMatchObject({
      providerRequestId: 'sponsored-provider-request',
      status: 'settled',
    });
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
        prepareProviderCall: async () =>
          vi.fn().mockResolvedValue({
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
          prepareProviderCall: async () => providerCall,
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
      prepareProviderCall: async () => providerCall,
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
        prepareProviderCall: async () => providerCall,
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
        prepareProviderCall: async () => providerCall,
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
      prepareProviderCall: async () =>
        vi.fn().mockResolvedValue({
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
    // The root budget remains reserved until its last operation completes.
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 0,
      balanceCredits: 100,
      heldCredits: 100,
    });
    expect((await client.query('SELECT status FROM platform_credit_reservations')).rows).toEqual([
      { status: 'released' },
    ]);
    await expect(
      completePlatformUsageSharedBudgetForOperation('unavailable-bounded-operation'),
    ).resolves.toBe(true);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 100,
      balanceCredits: 100,
      heldCredits: 0,
    });
  });

  it.each(['self', 'sponsored'] as const)(
    'releases only unclaimed preparation failures for %s billing',
    async (mode) => {
      const operationId = `preparation-cleanup-${mode}`;
      const context =
        mode === 'self'
          ? bindingContext
          : {
              actorUserId: sponsoredMemberUserId,
              workspaceId: null,
            };
      let handle;
      if (mode === 'self') {
        handle = await createRoot();
      } else {
        const input = await seedAuthorizedSponsoredGroup();
        handle = await createSponsoredPlatformUsageSharedBudget(db, sponsoredMemberUserId, {
          ...input,
          expectedPolicyVersion: 1,
        });
      }
      bindPlatformUsageSharedBudget(operationId, handle, context);
      const step = {
        ...context,
        inputHash: hashPlatformUsageProviderInput({ messages: ['preparation only'] }),
        kind: 'call_llm' as const,
        model: 'model-a',
        operationId,
        provider: 'provider-a',
      };
      await expect(
        runPlatformUsageSharedBudgetStep(handle, {
          ...step,
          stepIndex: 0,
          prepareProviderCall: async () => {
            throw new Error('bounded preparation unavailable');
          },
        }),
      ).rejects.toThrow('bounded preparation unavailable');
      await expect(
        runPlatformUsageSharedBudgetStep(handle, {
          ...step,
          stepIndex: 1,
          prepareProviderCall: async () => undefined as never,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BUDGET_CONTEXT' });
      const reservations = await client.query(
        'SELECT status FROM platform_credit_reservations ORDER BY created_at',
      );
      expect(reservations.rows).toEqual([{ status: 'released' }, { status: 'released' }]);
      await expect(completePlatformUsageSharedBudgetForOperation(operationId)).resolves.toBe(true);
      const payer = new PlatformCreditModel(
        db,
        mode === 'self' ? actorUserId : sponsoredOwnerUserId,
      );
      expect(await payer.getAvailableCredits()).toEqual({
        availableCredits: 100,
        balanceCredits: 100,
        heldCredits: 0,
      });
      expect(
        (await client.query("SELECT id FROM platform_credit_entries WHERE type='usage_charge'"))
          .rows,
      ).toEqual([]);
    },
  );

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
      prepareProviderCall: async () => providerCall,
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
    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        ...step,
        prepareProviderCall: async () => {
          throw new Error('replay preparation failed');
        },
      }),
    ).rejects.toThrow('replay preparation failed');

    expect(providerCall).toHaveBeenCalledTimes(1);
    await expect(ledger.getAvailableCredits()).resolves.toEqual({
      availableCredits: 0,
      balanceCredits: 100,
      heldCredits: 100,
    });
  });

  it('persists provider request evidence before a streamed call later fails', async () => {
    const budget = await createRoot();
    const operationId = 'provider-request-evidence-operation';
    bindPlatformUsageSharedBudget(operationId, budget, bindingContext);

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['private prompt'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId,
        provider: 'provider-a',
        prepareProviderCall:
          async () =>
          async ({ recordProviderRequestId }) => {
            await recordProviderRequestId('provider-request-stream-1');
            throw new Error('stream disconnected after response headers');
          },
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_OUTCOME_UNKNOWN' });

    const { rows } = await client.query<{
      provider_request_id: string | null;
      status: string;
    }>('SELECT provider_request_id,status FROM platform_credit_reservations');
    expect(rows).toEqual([
      { provider_request_id: 'provider-request-stream-1', status: 'provider_started' },
    ]);
  });

  it('retains a reservation claimed concurrently while preparation fails', async () => {
    const budget = await createRoot();
    const operationId = 'claim-races-preparation-cleanup';
    bindPlatformUsageSharedBudget(operationId, budget, bindingContext);
    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        ...bindingContext,
        inputHash: 'racing-claim-input',
        kind: 'call_llm',
        model: 'model-a',
        operationId,
        provider: 'provider-a',
        stepIndex: 0,
        prepareProviderCall: async () => {
          const { rows } = await client.query<{ id: string; lease_version: number }>(
            'SELECT id,lease_version FROM platform_credit_reservations',
          );
          await new PlatformUsageReservationService(db, actorUserId).claim({
            leaseVersion: Number(rows[0].lease_version),
            reservationId: rows[0].id,
          });
          throw new Error('preparation failed after racing claim');
        },
      }),
    ).rejects.toMatchObject({
      code: 'RESERVATION_FAILED',
      message: 'Platform usage preparation failed and reservation cleanup could not be confirmed.',
    });
    expect((await client.query('SELECT status FROM platform_credit_reservations')).rows).toEqual([
      { status: 'provider_started' },
    ]);
    expect(await ledger.getAvailableCredits()).toEqual({
      availableCredits: 0,
      balanceCredits: 100,
      heldCredits: 100,
    });
  });

  it.each([
    { error: { status: 401, message: 'secret API key' }, detail: 'HTTP 401' },
    { error: { error: { status: 400, body: 'private prompt' } }, detail: 'HTTP 400' },
    {
      error: { response: { status: 429, headers: { authorization: 'secret' } } },
      detail: 'HTTP 429',
    },
    { error: { cause: { code: 'ETIMEDOUT' }, message: 'secret endpoint' }, detail: 'timeout' },
    { error: { code: 'ECONNRESET', message: 'secret endpoint' }, detail: 'connection failure' },
    {
      error: {
        status: 400,
        error: { code: 'InvalidParameter', param: 'n', message: 'private prompt' },
      },
      detail: 'HTTP 400; code=InvalidParameter; param=n',
    },
    {
      error: {
        error: {
          status: 400,
          cause: { code: 'unsupported_parameter', param: 'safety_identifier' },
        },
      },
      detail: 'HTTP 400; code=unsupported_parameter; param=safety_identifier',
    },
    {
      error: { status: 400, code: 'private-prompt-as-code', param: 'secret-api-key' },
      detail: 'HTTP 400',
    },
    {
      error: { status: 400, code: 'InvalidParameter.secret', param: 'n\nprivate prompt' },
      detail: 'HTTP 400',
    },
    {
      error: { status: 400, error: { code: 'InvalidParameter', param: { value: 'secret' } } },
      detail: 'HTTP 400; code=InvalidParameter',
    },
    {
      error: { status: 400, body: '{"code":"InvalidParameter","param":"n"}' },
      detail: 'HTTP 400',
    },
  ])(
    'preserves only safe provider diagnostics ($detail) without releasing the reservation',
    async ({ error, detail }) => {
      const budget = await createRoot();
      const operationId = `safe-diagnostic-operation-${hashPlatformUsageProviderInput(error)}`;
      bindPlatformUsageSharedBudget(operationId, budget, bindingContext);
      const providerCall = vi.fn().mockRejectedValue(error);
      const failure = await runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['private prompt'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId,
        provider: 'provider-a',
        prepareProviderCall: async () => providerCall,
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }).catch((caught: unknown) => caught);

      expect(failure).toMatchObject({
        code: 'PROVIDER_OUTCOME_UNKNOWN',
        message: `Platform usage provider outcome is unknown. Diagnostic: ${detail}.`,
      });
      expect(JSON.stringify(failure)).not.toMatch(/secret|private prompt|authorization/);
      expect((failure as Error).cause).toBeUndefined();
      expect(providerCall).toHaveBeenCalledOnce();
      await expect(ledger.getAvailableCredits()).resolves.toEqual({
        availableCredits: 0,
        balanceCredits: 100,
        heldCredits: 100,
      });
    },
  );

  it('persists an allowlisted provider request id from an HTTP failure without storing headers', async () => {
    const budget = await createRoot();
    const operationId = 'http-provider-request-evidence';
    bindPlatformUsageSharedBudget(operationId, budget, bindingContext);
    const providerCall = vi.fn().mockRejectedValue({
      headers: {
        'authorization': 'Bearer provider-secret',
        'x-tt-logid': 'provider-log-id-429',
      },
      status: 429,
    });

    await expect(
      runPlatformUsageSharedBudgetStep(budget, {
        actorUserId,
        inputHash: hashPlatformUsageProviderInput({ messages: ['private prompt'] }),
        kind: 'call_llm',
        model: 'model-a',
        operationId,
        provider: 'provider-a',
        prepareProviderCall: async () => providerCall,
        stepIndex: 0,
        workspaceId: 'workspace-a',
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_OUTCOME_UNKNOWN',
      message: 'Platform usage provider outcome is unknown. Diagnostic: HTTP 429.',
    });

    const { rows } = await client.query<{
      provider_request_id: string | null;
      status: string;
    }>('SELECT provider_request_id,status FROM platform_credit_reservations');
    expect(rows).toEqual([
      { provider_request_id: 'provider-log-id-429', status: 'provider_started' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('provider-secret');
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
        prepareProviderCall: async () => async () => {
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
