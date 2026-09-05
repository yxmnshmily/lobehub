// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  platformCreditAccounts,
  platformCreditEntries,
  roles,
  userRoles,
  users,
} from '@/database/schemas';

import { platformCreditRouter } from '../platformCredit';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const adminId = 'platform-credit-route-admin';
const customerAId = 'platform-credit-route-customer-a';
const customerBId = 'platform-credit-route-customer-b';
const customerIds = [customerAId, customerBId];

const adminCaller = () =>
  platformCreditRouter.createCaller({ serverDB: db, userId: adminId } as any);
const customerACaller = () =>
  platformCreditRouter.createCaller({ serverDB: db, userId: customerAId } as any);

beforeAll(async () => {
  await db
    .insert(users)
    .values([{ id: adminId }, { id: customerAId }, { id: customerBId }])
    .onConflictDoNothing();
  await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, isSystem: true, name: 'super_admin' })
    .onConflictDoNothing();
  const role = await db.query.roles.findFirst({ where: eq(roles.name, 'super_admin') });
  if (!role) throw new Error('Missing super_admin role in test setup');
  await db
    .insert(userRoles)
    .values({ roleId: role.id, userId: adminId, workspaceId: null })
    .onConflictDoNothing();
});

beforeEach(async () => {
  await db
    .delete(platformCreditAccounts)
    .where(inArray(platformCreditAccounts.userIdSnapshot, customerIds));
});

afterAll(async () => {
  await db
    .delete(platformCreditAccounts)
    .where(inArray(platformCreditAccounts.userIdSnapshot, customerIds));
  await db.delete(userRoles).where(eq(userRoles.userId, adminId));
  await db.delete(users).where(inArray(users.id, [adminId, ...customerIds]));
});

describe('platform Credits tRPC authorization and contracts', () => {
  it('derives ordinary-user reads from ctx.userId and rejects caller-supplied targets', async () => {
    await adminCaller().topUp({
      credits: 100,
      idempotencyKey: 'customer-a-isolation',
      reason: 'A 客户充值',
      targetUserId: customerAId,
    });
    await adminCaller().topUp({
      credits: 900,
      idempotencyKey: 'customer-b-isolation',
      reason: 'B 客户充值',
      targetUserId: customerBId,
    });

    await expect(customerACaller().getOwnAccount()).resolves.toMatchObject({
      balanceCredits: 100,
    });
    const entries = await customerACaller().listOwnEntries({ limit: 20 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amountCredits: 100, balanceAfterCredits: 100 });
    expect(Object.keys(entries[0]).sort()).toEqual([
      'amountCredits',
      'balanceAfterCredits',
      'createdAt',
      'id',
      'type',
    ]);
    expect(JSON.stringify(entries)).not.toContain('B 客户充值');

    await expect(
      customerACaller().getOwnAccount({ targetUserId: customerBId } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      customerACaller().listOwnEntries({ limit: 20, targetUserId: customerBId } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    for (const expansion of [
      { details: true },
      { include: ['provider', 'model'] },
      { select: ['generationId'] },
    ]) {
      await expect(
        customerACaller().listOwnEntries({ limit: 20, ...expansion } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
  });

  it('rejects every cross-user read and mutation from an ordinary customer', async () => {
    const caller = customerACaller();

    await expect(caller.getUserAccount({ targetUserId: customerBId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      caller.listUserEntries({ limit: 20, targetUserId: customerBId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.topUp({
        credits: 1_000_000,
        idempotencyKey: 'forbidden-top-up',
        reason: '越权充值',
        targetUserId: customerBId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.adjust({
        credits: -1,
        idempotencyKey: 'forbidden-adjustment',
        reason: '越权调整',
        targetUserId: customerBId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.reverse({
        entryId: '00000000-0000-4000-8000-000000000001',
        idempotencyKey: 'forbidden-reversal',
        reason: '越权冲正',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('uses idempotent signed integer Credits and returns only the public ledger allowlist', async () => {
    const caller = adminCaller();
    const topUpInput = {
      credits: 1_000_000,
      idempotencyKey: 'IDEMPOTENCY_KEY_MUST_NOT_LEAK',
      reason: '充值 100 万 Credits',
      targetUserId: customerAId,
    };

    const topUp = await caller.topUp(topUpInput);
    const replay = await caller.topUp(topUpInput);
    expect(replay.id).toBe(topUp.id);

    await db
      .update(platformCreditEntries)
      .set({ tokenUsage: { providerApiKey: 'TOKEN_USAGE_KEY_MUST_NOT_LEAK' } as any })
      .where(eq(platformCreditEntries.id, topUp.id));

    const adjustment = await caller.adjust({
      credits: -250_000,
      idempotencyKey: 'adjustment-route-test',
      reason: '人工校准 Credits',
      targetUserId: customerAId,
    });
    const reversalInput = {
      entryId: adjustment.id,
      idempotencyKey: 'reversal-route-test',
      reason: '撤销人工校准',
    };
    const reversal = await caller.reverse(reversalInput);
    const reversalReplay = await caller.reverse(reversalInput);

    expect(reversalReplay.id).toBe(reversal.id);
    await expect(caller.getUserAccount({ targetUserId: customerAId })).resolves.toMatchObject({
      balanceCredits: 1_000_000,
    });
    await expect(caller.getUserAccount({ targetUserId: customerBId })).resolves.toMatchObject({
      balanceCredits: 0,
    });

    const adminEntries = await caller.listUserEntries({ limit: 20, targetUserId: customerAId });
    const ownEntries = await customerACaller().listOwnEntries({ limit: 20 });
    expect(adminEntries).toHaveLength(3);
    expect(ownEntries).toHaveLength(3);
    expect(adminEntries.map(({ amountCredits }) => amountCredits).sort((a, b) => a - b)).toEqual([
      -250_000, 250_000, 1_000_000,
    ]);

    expect(Object.keys(await caller.getUserAccount({ targetUserId: customerAId })).sort()).toEqual([
      'balanceCredits',
      'updatedAt',
    ]);
    expect(Object.keys(adminEntries[0]).sort()).toEqual([
      'amountCredits',
      'balanceAfterCredits',
      'costUsd',
      'createdAt',
      'generationId',
      'generationType',
      'id',
      'model',
      'provider',
      'reason',
      'reversalOfEntryId',
      'type',
      'updatedAt',
    ]);
    expect(Object.keys(ownEntries[0]).sort()).toEqual([
      'amountCredits',
      'balanceAfterCredits',
      'createdAt',
      'id',
      'type',
    ]);
    expect(JSON.stringify(ownEntries)).not.toMatch(
      /costUsd|generationId|generationType|model|provider|reason|reversalOfEntryId|idempotencyKey|tokenUsage|metadata/,
    );

    const serialized = JSON.stringify({ adminEntries, ownEntries, topUp });
    for (const forbidden of [
      'IDEMPOTENCY_KEY_MUST_NOT_LEAK',
      'TOKEN_USAGE_KEY_MUST_NOT_LEAK',
      'userIdSnapshot',
      'idempotencyKey',
      'tokenUsage',
      'operatorUserId',
      'balanceFen',
      'amountFen',
      'totalConsumptionFen',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects fractional, zero, unsafe, empty, and out-of-range inputs before ledger writes', async () => {
    const caller = adminCaller();
    const validTopUp = {
      credits: 10,
      idempotencyKey: 'strict-boundary',
      reason: '严格边界',
      targetUserId: customerAId,
    };

    for (const credits of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(caller.topUp({ ...validTopUp, credits })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    for (const credits of [0, 1.5, Number.MIN_SAFE_INTEGER - 1]) {
      await expect(caller.adjust({ ...validTopUp, credits })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    }
    await expect(caller.topUp({ ...validTopUp, idempotencyKey: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.topUp({ ...validTopUp, reason: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.topUp({ ...validTopUp, targetUserId: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    for (const limit of [0, 201, 1.5]) {
      await expect(
        caller.listUserEntries({ limit, targetUserId: customerAId }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(caller.topUp({ ...validTopUp, unknown: true } as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(caller.listUserEntries({ targetUserId: customerAId })).resolves.toEqual([]);
  });
});
