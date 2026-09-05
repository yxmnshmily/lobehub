// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type LobeChatDatabase,
  PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
  PLATFORM_CREDIT_USAGE_EXCEEDS_RESERVATION,
  PlatformCreditAdminModel,
  PlatformCreditModel,
} from '@lobechat/database';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { PGlite } from '../../../../../packages/database/node_modules/@electric-sql/pglite';
import { PlatformUsageReservationError, PlatformUsageReservationService } from './index';

const userA = 'reservation-user-a';
const userB = 'reservation-user-b';
const adminId = 'reservation-admin';

let client: PGlite;
let db: LobeChatDatabase;
let ledgerA: PlatformCreditModel;
let serviceA: PlatformUsageReservationService;

const migrationPaths = [
  path.join(
    __dirname,
    '../../../../../packages/database/migrations/0156_platform_credit_ledger.sql',
  ),
  path.join(
    __dirname,
    '../../../../../packages/database/migrations/0161_platform_credit_reservations.sql',
  ),
];

const applyMigration = async (database: PGlite, migrationPath: string) => {
  const statements = readFileSync(migrationPath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await database.exec(statement);
};

const expiresAt = () => new Date(Date.now() + 60_000);

const explicitLimit = (maxCredits: number) => ({
  maxCredits,
  source: 'user-explicit' as const,
});

const reserveRequest = (suffix: string, maxCredits = 80, workspaceId = 'workspace-a') =>
  serviceA.reserveRequest({
    expiresAt: expiresAt(),
    idempotencyKey: `request:${suffix}`,
    limit: explicitLimit(maxCredits),
    sourceId: `operation:${suffix}`,
    sourceType: 'agent-operation',
    workspaceId,
  });

const reserveCall = async (suffix: string, maxCredits = 80, workspaceId = 'workspace-a') => {
  const request = await reserveRequest(suffix, maxCredits, workspaceId);
  const reservation = await serviceA.reserveCall({
    budgetId: request.id,
    callKind: 'call_llm',
    expiresAt: expiresAt(),
    generationId: `operation:${suffix}:step:0:call_llm`,
    generationType: 'agent-runtime-text-step',
    idempotencyKey: `call:${suffix}`,
    limit: explicitLimit(maxCredits),
    model: 'model-a',
    provider: 'provider-a',
    workspaceId,
  });
  return { request, reservation };
};

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client) as unknown as LobeChatDatabase;

  await client.exec(`
    CREATE TABLE users (id text PRIMARY KEY);
    INSERT INTO users (id) VALUES ('${userA}'), ('${userB}'), ('${adminId}');
  `);
  for (const migrationPath of migrationPaths) await applyMigration(client, migrationPath);

  await new PlatformCreditAdminModel(db, adminId).topUp({
    credits: 100,
    idempotencyKey: 'top-up:reservation-user-a',
    reason: 'reservation orchestration tests',
    targetUserId: userA,
  });
  ledgerA = new PlatformCreditModel(db, userA);
  serviceA = new PlatformUsageReservationService(db, userA, ledgerA);
});

describe('PlatformUsageReservationService', () => {
  it('admits only a user-explicit positive safe maxCredits or a referenced hard-limit proof', () => {
    expect(serviceA.previewExplicitLimit(explicitLimit(40))).toEqual({
      maxCredits: 40,
      source: 'user-explicit',
    });
    expect(
      serviceA.previewExplicitLimit({
        maxCredits: 50,
        proof: { kind: 'provider-contract', reference: 'provider-doc:v1:max-output' },
        source: 'proven-hard-limit',
      }),
    ).toEqual({
      maxCredits: 50,
      proof: { kind: 'provider-contract', reference: 'provider-doc:v1:max-output' },
      source: 'proven-hard-limit',
    });

    for (const input of [
      { maxCredits: 10, source: 'approximate-cost' },
      { maxCredits: 10, source: 'positive-balance' },
      { maxCredits: 10, source: 'fixed-travel-price' },
      {
        maxCredits: 10,
        proof: { kind: 'provider-contract', reference: '   ' },
        source: 'proven-hard-limit',
      },
      explicitLimit(0),
      explicitLimit(1.5),
      explicitLimit(Number.MAX_SAFE_INTEGER + 1),
    ]) {
      expect(() => serviceA.previewExplicitLimit(input as never)).toThrow(
        PlatformUsageReservationError,
      );
    }
  });

  it('replays exact request and call keys but rejects changed material under either key', async () => {
    const requestExpiresAt = expiresAt();
    const requestInput = {
      expiresAt: requestExpiresAt,
      idempotencyKey: 'request:idempotent',
      limit: explicitLimit(80),
      sourceId: 'operation:idempotent',
      sourceType: 'agent-operation',
      workspaceId: 'workspace-a',
    };
    const firstRequest = await serviceA.reserveRequest(requestInput);
    await expect(serviceA.reserveRequest(requestInput)).resolves.toMatchObject({
      id: firstRequest.id,
    });
    await expect(
      serviceA.reserveRequest({ ...requestInput, limit: explicitLimit(79) }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

    const callExpiresAt = expiresAt();
    const callInput = {
      budgetId: firstRequest.id,
      callKind: 'call_llm' as const,
      expiresAt: callExpiresAt,
      generationId: 'operation:idempotent:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:idempotent',
      limit: explicitLimit(80),
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    };
    const firstCall = await serviceA.reserveCall(callInput);
    await expect(serviceA.reserveCall(callInput)).resolves.toMatchObject({ id: firstCall.id });
    await expect(serviceA.reserveCall({ ...callInput, provider: 'provider-b' })).rejects.toThrow(
      PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
    );
  });

  it('settles only authoritative ModelUsage and releases the unused request maximum', async () => {
    const { request, reservation } = await reserveCall('lower-actual');
    const claim = await serviceA.claim({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    const result = await serviceA.completeAndSettle({
      completeRequest: true,
      leaseVersion: claim.reservation.leaseVersion,
      providerRequestId: 'provider-request-lower-actual',
      reservationId: reservation.id,
      usage: { cost: 0.00003, totalTokens: 987 },
    });

    expect(result.entry).toMatchObject({
      amountCredits: -30,
      balanceAfterCredits: 70,
      tokenUsage: { totalTokens: 987 },
    });
    expect(result.request).toMatchObject({
      consumedCredits: 30,
      id: request.id,
      status: 'settled',
    });
    await expect(ledgerA.getAvailableCredits()).resolves.toEqual({
      availableCredits: 70,
      balanceCredits: 70,
      heldCredits: 0,
    });
  });

  it('replays exact authoritative settlement but rejects changed actual usage', async () => {
    const { reservation } = await reserveCall('settlement-replay');
    const claim = await serviceA.claim({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });
    const input = {
      completeRequest: true,
      leaseVersion: claim.reservation.leaseVersion,
      reservationId: reservation.id,
      usage: { cost: 0.00002, totalTokens: 777 },
    } as const;

    const first = await serviceA.completeAndSettle(input);
    const replay = await serviceA.completeAndSettle(input);

    expect(replay.entry.id).toBe(first.entry.id);
    await expect(
      serviceA.completeAndSettle({
        ...input,
        usage: { cost: 0.00003, totalTokens: 888 },
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
  });

  it('fails closed without a debit when actual usage exceeds the reserved hard maximum', async () => {
    const { reservation } = await reserveCall('over-limit', 20);
    const claim = await serviceA.claim({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    await expect(
      serviceA.completeAndSettle({
        completeRequest: true,
        leaseVersion: claim.reservation.leaseVersion,
        reservationId: reservation.id,
        usage: { cost: 0.00003, totalTokens: 999 },
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_USAGE_EXCEEDS_RESERVATION);

    await expect(ledgerA.getAccount()).resolves.toMatchObject({ balanceCredits: 100 });
    await expect(ledgerA.listEntries()).resolves.toHaveLength(1);
    await expect(ledgerA.getReservation(reservation.id)).resolves.toMatchObject({
      settledCredits: 0,
      status: 'provider_completed',
    });
  });

  it('rejects a stale lease before the provider claim', async () => {
    const { reservation } = await reserveCall('stale-lease');
    await ledgerA.renewReservationLease({
      expiresAt: new Date(Date.now() + 120_000),
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    await expect(
      serviceA.claim({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow('Credits 预留租约已失效');
  });

  it('keeps request and call reservations isolated across user and workspace ownership', async () => {
    const request = await reserveRequest('ownership', 40, 'workspace-a');
    const serviceB = new PlatformUsageReservationService(db, userB);
    const callInput = {
      budgetId: request.id,
      callKind: 'call_llm' as const,
      expiresAt: expiresAt(),
      generationId: 'operation:ownership:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:ownership',
      limit: explicitLimit(20),
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    };

    await expect(
      serviceA.reserveCall({ ...callInput, workspaceId: 'workspace-b' }),
    ).rejects.toThrow('Credits 预留归属无效');
    await expect(serviceB.reserveCall(callInput)).rejects.toThrow('Credits 预留归属无效');
  });

  it('only exposes a reservation to its owning actor', async () => {
    const { reservation } = await reserveCall('inspect-ownership');
    const serviceB = new PlatformUsageReservationService(db, userB);

    await expect(serviceA.getReservation(reservation.id)).resolves.toMatchObject({
      id: reservation.id,
      workspaceId: 'workspace-a',
    });
    await expect(serviceB.getReservation(reservation.id)).resolves.toBeUndefined();
  });

  it('releases an unclaimed call and prevents any later provider claim', async () => {
    const { reservation } = await reserveCall('release-before-claim');

    await expect(
      serviceA.releaseUnclaimed({
        completeRequest: true,
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).resolves.toMatchObject({
      request: { status: 'settled' },
      reservation: { status: 'released' },
    });
    await expect(ledgerA.getAvailableCredits()).resolves.toEqual({
      availableCredits: 100,
      balanceCredits: 100,
      heldCredits: 0,
    });
    await expect(
      serviceA.claim({
        leaseVersion: reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow('Credits 预留状态无效');
  });

  it('never releases a claimed call while the provider outcome is unknown', async () => {
    const { reservation } = await reserveCall('unknown-provider-outcome');
    const claim = await serviceA.claim({
      leaseVersion: reservation.leaseVersion,
      reservationId: reservation.id,
    });

    await expect(
      serviceA.releaseUnclaimed({
        leaseVersion: claim.reservation.leaseVersion,
        reservationId: reservation.id,
      }),
    ).rejects.toThrow('Credits 预留状态不允许释放');
    await expect(ledgerA.getReservation(reservation.id)).resolves.toMatchObject({
      status: 'provider_started',
    });
  });

  it('reserves the whole remaining request budget without an estimate or catalog price', async () => {
    const request = await reserveRequest('remaining-service', 80);

    const reservation = await serviceA.reserveRemainingCall({
      budgetId: request.id,
      budgetLeaseVersion: request.leaseVersion,
      callKind: 'call_llm',
      expiresAt: request.expiresAt,
      generationId: 'operation:remaining-service:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:remaining-service',
      inputHash: 'input-hash-remaining-service',
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    });

    expect(reservation).toMatchObject({ reservedCredits: 80, status: 'reserved' });
  });

  it('supports multiple steps by releasing unused capacity after completeRequest false', async () => {
    const request = await reserveRequest('remaining-multi-step', 100);
    const first = await serviceA.reserveRemainingCall({
      budgetId: request.id,
      budgetLeaseVersion: request.leaseVersion,
      callKind: 'call_llm',
      expiresAt: request.expiresAt,
      generationId: 'operation:remaining-multi-step:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:remaining-multi-step:0',
      inputHash: 'input-hash-remaining-multi-step-0',
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    });
    const claimed = await serviceA.claim({
      leaseVersion: first.leaseVersion,
      reservationId: first.id,
    });
    await serviceA.completeAndSettle({
      completeRequest: false,
      leaseVersion: claimed.reservation.leaseVersion,
      reservationId: first.id,
      usage: { cost: 0.00003, totalTokens: 100 },
    });

    const second = await serviceA.reserveRemainingCall({
      budgetId: request.id,
      budgetLeaseVersion: request.leaseVersion,
      callKind: 'call_llm',
      expiresAt: request.expiresAt,
      generationId: 'operation:remaining-multi-step:step:1:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:remaining-multi-step:1',
      inputHash: 'input-hash-remaining-multi-step-1',
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    });

    expect(second).toMatchObject({ reservedCredits: 70, status: 'reserved' });
  });

  it('rejects cross-user and cross-workspace remaining-budget allocation', async () => {
    const request = await reserveRequest('remaining-owner', 80, 'workspace-a');
    const serviceB = new PlatformUsageReservationService(db, userB);
    const input = {
      budgetId: request.id,
      budgetLeaseVersion: request.leaseVersion,
      callKind: 'call_llm' as const,
      expiresAt: request.expiresAt,
      generationId: 'operation:remaining-owner:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:remaining-owner',
      inputHash: 'input-hash-remaining-owner',
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    };

    await expect(
      serviceA.reserveRemainingCall({ ...input, workspaceId: 'workspace-b' }),
    ).rejects.toThrow('Credits 预留归属无效');
    await expect(serviceB.reserveRemainingCall(input)).rejects.toThrow('Credits 预留归属无效');
  });

  it('replays the same logical call across lease metadata changes but conflicts on request drift', async () => {
    const request = await reserveRequest('remaining-input-replay', 80);
    const callExpiresAt = request.expiresAt;
    const input = {
      budgetId: request.id,
      budgetLeaseVersion: request.leaseVersion,
      callKind: 'call_llm' as const,
      expiresAt: callExpiresAt,
      generationId: 'operation:remaining-input-replay:step:0:call_llm',
      generationType: 'agent-runtime-text-step',
      idempotencyKey: 'call:remaining-input-replay',
      inputHash: 'input-hash-a',
      model: 'model-a',
      provider: 'provider-a',
      workspaceId: 'workspace-a',
    };

    const first = await serviceA.reserveRemainingCall(input);
    await expect(serviceA.reserveRemainingCall(input)).resolves.toMatchObject({ id: first.id });
    await expect(
      serviceA.reserveRemainingCall({
        ...input,
        budgetLeaseVersion: request.leaseVersion + 1,
        expiresAt: new Date(callExpiresAt.getTime() + 1),
      }),
    ).resolves.toMatchObject({ expiresAt: first.expiresAt, id: first.id });
    await expect(
      serviceA.reserveRemainingCall({ ...input, inputHash: 'input-hash-b' }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

    await serviceA.releaseUnclaimed({
      leaseVersion: first.leaseVersion,
      reservationId: first.id,
    });
    await expect(
      serviceA.reserveRemainingCall({
        ...input,
        generationId: 'operation:remaining-input-replay:step:1:call_llm',
        inputHash: 'input-hash-c',
      }),
    ).rejects.toThrow(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
  });

  it('rejects a remaining-call lease that outlives its request budget', async () => {
    const budgetExpiresAt = new Date(Date.now() + 60_000);
    const request = await serviceA.reserveRequest({
      expiresAt: budgetExpiresAt,
      idempotencyKey: 'request:remaining-child-expiry',
      limit: explicitLimit(80),
      sourceId: 'operation:remaining-child-expiry',
      sourceType: 'agent-operation',
      workspaceId: 'workspace-a',
    });

    await expect(
      serviceA.reserveRemainingCall({
        budgetId: request.id,
        budgetLeaseVersion: request.leaseVersion,
        callKind: 'call_llm',
        expiresAt: new Date(budgetExpiresAt.getTime() + 1),
        generationId: 'operation:remaining-child-expiry:step:0:call_llm',
        generationType: 'agent-runtime-text-step',
        idempotencyKey: 'call:remaining-child-expiry',
        inputHash: 'input-hash-remaining-child-expiry',
        model: 'model-a',
        provider: 'provider-a',
        workspaceId: 'workspace-a',
      }),
    ).rejects.toThrow('Credits 预留状态无效');
  });
});
