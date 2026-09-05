// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import {
  roles,
  travelServiceAccounts,
  travelServiceLedgerEntries,
  travelServiceOrders,
  userRoles,
  users,
} from '@/database/schemas';

import { travelServiceLedgerRouter } from '../travelServiceLedger';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const db = await getTestDB();
const customerId = 'service-ledger-route-customer';
const otherCustomerId = 'service-ledger-route-other';
const adminId = 'service-ledger-route-admin';
const bannedAdminId = 'service-ledger-route-banned-admin';
const deletedAdminId = 'service-ledger-route-deleted-admin';
const standardAdminId = 'service-ledger-route-standard-admin';

const customerCaller = () =>
  travelServiceLedgerRouter.createCaller({ serverDB: db, userId: customerId } as any);
const adminCaller = () =>
  travelServiceLedgerRouter.createCaller({ serverDB: db, userId: adminId } as any);
const callerFor = (userId: string) =>
  travelServiceLedgerRouter.createCaller({ serverDB: db, userId } as any);

beforeAll(async () => {
  await db.insert(users).values([
    { fullName: '客户', id: customerId },
    { fullName: '其他客户', id: otherCustomerId },
    { fullName: '平台管理员', id: adminId },
    { banned: true, fullName: '已封禁平台管理员', id: bannedAdminId },
    { fullName: '已删除平台管理员', id: deletedAdminId },
    { fullName: '普通管理员', id: standardAdminId },
  ]);
  const [superAdminRole] = await db
    .insert(roles)
    .values({ displayName: 'Super Admin', isActive: true, name: 'super_admin' })
    .returning();
  const [standardAdminRole] = await db
    .insert(roles)
    .values({ displayName: 'Admin', isActive: true, name: 'admin' })
    .returning();
  await db.insert(userRoles).values([
    { roleId: superAdminRole.id, userId: adminId },
    { roleId: superAdminRole.id, userId: bannedAdminId },
    { roleId: superAdminRole.id, userId: deletedAdminId },
    { roleId: standardAdminRole.id, userId: standardAdminId },
  ]);
  await db.delete(users).where(eq(users.id, deletedAdminId));
});

afterAll(async () => {
  await db.delete(travelServiceLedgerEntries);
  await db.delete(travelServiceOrders);
  await db.delete(travelServiceAccounts);
  await db
    .delete(userRoles)
    .where(inArray(userRoles.userId, [adminId, bannedAdminId, standardAdminId]));
  await db.delete(roles).where(inArray(roles.name, ['admin', 'super_admin']));
  await db
    .delete(users)
    .where(
      inArray(users.id, [customerId, otherCustomerId, adminId, bannedAdminId, standardAdminId]),
    );
});

describe('travel service ledger tRPC authorization', () => {
  it('lets a customer read only the account bound to the authenticated user', async () => {
    await expect(customerCaller().getAccount()).resolves.toMatchObject({
      balanceFen: 0,
      currency: 'CNY',
    });
    await expect(customerCaller().listEntries()).resolves.toEqual([]);
    await expect(customerCaller().listOrders()).resolves.toEqual([]);
  });

  it('rejects an ordinary customer from all-user reads and manual writes', async () => {
    await expect(customerCaller().adminListAccounts()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      customerCaller().adminPostManualEntry({
        amountFen: 100,
        idempotencyKey: 'forbidden-credit',
        reason: '越权入账',
        targetUserId: otherCustomerId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      customerCaller().adminCreateOrder({
        amountFen: 12_800,
        idempotencyKey: 'forbidden-order',
        targetUserId: otherCustomerId,
        title: '越权创建订单',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each([
    ['an ordinary customer', customerId],
    ['a standard admin', standardAdminId],
    ['a banned super_admin', bannedAdminId],
    ['a deleted super_admin', deletedAdminId],
  ])('rejects every admin procedure for %s', async (_, userId) => {
    const caller = callerFor(userId);
    const calls = [
      () => caller.adminListAccounts(),
      () => caller.adminListEntries(),
      () => caller.adminListOrders(),
      () =>
        caller.adminCreateOrder({
          amountFen: 100,
          idempotencyKey: `forbidden-order-${userId}`,
          targetUserId: otherCustomerId,
          title: '越权订单',
        }),
      () =>
        caller.adminPostManualEntry({
          amountFen: 100,
          idempotencyKey: `forbidden-entry-${userId}`,
          reason: '越权入账',
          targetUserId: otherCustomerId,
        }),
      () =>
        caller.adminReverseEntry({
          entryId: '00000000-0000-4000-8000-000000000001',
          idempotencyKey: `forbidden-reversal-${userId}`,
          reason: '越权冲正',
        }),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('allows only super_admin to inspect accounts and post an audited entry', async () => {
    await adminCaller().adminPostManualEntry({
      amountFen: 8_800,
      idempotencyKey: 'admin-credit-1',
      reason: '线下收款凭证已核对',
      targetUserId: customerId,
    });

    await expect(customerCaller().getAccount()).resolves.toMatchObject({
      balanceFen: 8_800,
    });
    const accounts = await adminCaller().adminListAccounts();
    expect(accounts.some(({ account }) => account.userId === customerId)).toBe(true);
  });

  it('rejects fractional fen values at the API boundary', async () => {
    await expect(
      adminCaller().adminPostManualEntry({
        amountFen: 1.5,
        idempotencyKey: 'fractional-fen',
        reason: '非法小数',
        targetUserId: customerId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('lets only super_admin create a positive-fen service order visible to its owner', async () => {
    await expect(
      adminCaller().adminCreateOrder({
        amountFen: 12_800,
        idempotencyKey: 'route-order-once',
        targetUserId: customerId,
        title: '定制行程策划',
      }),
    ).resolves.toMatchObject({
      amountFen: 12_800,
      status: 'pending',
      title: '定制行程策划',
      userId: customerId,
    });

    await expect(
      adminCaller().adminCreateOrder({
        amountFen: 12_800,
        idempotencyKey: 'route-order-once',
        targetUserId: customerId,
        title: '定制行程策划',
      }),
    ).resolves.toMatchObject({ id: expect.any(String) });

    await expect(customerCaller().listOrders()).resolves.toEqual([
      expect.objectContaining({ amountFen: 12_800, title: '定制行程策划' }),
    ]);
    await expect(
      adminCaller().adminCreateOrder({
        amountFen: 0,
        idempotencyKey: 'zero-order',
        targetUserId: customerId,
        title: '非法零元订单',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      adminCaller().adminCreateOrder({
        amountFen: 1.5,
        idempotencyKey: 'fractional-order',
        targetUserId: customerId,
        title: '非法小数订单',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('lets only super_admin reverse an audited entry once and reuses the same idempotency result', async () => {
    const original = (await adminCaller().adminListEntries()).find(
      (entry) => entry.userId === customerId && entry.type === 'manual_adjustment',
    );
    expect(original).toBeDefined();

    await expect(
      customerCaller().adminReverseEntry({
        entryId: original!.id,
        idempotencyKey: 'forbidden-reversal',
        reason: '越权冲正',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const input = {
      entryId: original!.id,
      idempotencyKey: 'admin-reversal-1',
      reason: '原收款确认作废',
    };
    const first = await adminCaller().adminReverseEntry(input);
    const repeated = await adminCaller().adminReverseEntry(input);

    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      amountFen: -8_800,
      reversalOfEntryId: original!.id,
      type: 'reversal',
    });
    await expect(customerCaller().getAccount()).resolves.toMatchObject({ balanceFen: 0 });

    await expect(
      adminCaller().adminReverseEntry({
        entryId: first.id,
        idempotencyKey: 'reverse-reversal-route',
        reason: '不允许冲正冲正流水',
      }),
    ).rejects.toThrow('冲正流水不能再次冲正');
  });

  it('returns strict customer projections without internal ledger fields', async () => {
    await adminCaller().adminPostManualEntry({
      amountFen: 1_500,
      idempotencyKey: 'CUSTOMER_ENTRY_IDEMPOTENCY_MUST_NOT_LEAK',
      reason: 'INTERNAL_LEDGER_NOTE_MUST_NOT_LEAK',
      targetUserId: customerId,
    });
    const internalOrder = await adminCaller().adminCreateOrder({
      amountFen: 6_600,
      idempotencyKey: 'CUSTOMER_ORDER_IDEMPOTENCY_MUST_NOT_LEAK',
      targetUserId: customerId,
      title: '客户可见的行程规划',
    });

    const account = await customerCaller().getAccount();
    const entries = await customerCaller().listEntries({ limit: 100 });
    const orders = await customerCaller().listOrders({ limit: 100 });

    expect(Object.keys(account).sort()).toEqual(['balanceFen', 'currency', 'updatedAt']);
    expect(entries.length).toBeGreaterThan(0);
    expect(orders.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual([
        'amountFen',
        'balanceAfterFen',
        'createdAt',
        'type',
      ]);
    }
    for (const order of orders) {
      expect(Object.keys(order).sort()).toEqual([
        'amountFen',
        'createdAt',
        'id',
        'status',
        'title',
        'updatedAt',
      ]);
      expect(order.id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    }
    const publicOrder = orders.find(({ title }) => title === '客户可见的行程规划');
    expect(publicOrder?.id).not.toBe(internalOrder.id);
    await expect(customerCaller().listOrders({ limit: 100 })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: publicOrder?.id })]),
    );

    expect(JSON.stringify({ account, entries, orders })).not.toMatch(
      /accountId|userId|operatorUserId|reversalOfEntryId|idempotencyKey|orderId|reason|metadata|CUSTOMER_.*_MUST_NOT_LEAK|INTERNAL_LEDGER_NOTE_MUST_NOT_LEAK/,
    );
  });

  it('rejects customer attempts to expand fields or select another user', async () => {
    await expect(
      (customerCaller().getAccount as any)({ targetUserId: otherCustomerId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    for (const procedure of [customerCaller().listEntries, customerCaller().listOrders]) {
      for (const expansion of [
        { details: true },
        { include: ['reason', 'idempotencyKey'] },
        { select: ['reversalOfEntryId'] },
        { targetUserId: otherCustomerId },
      ]) {
        await expect(procedure({ limit: 20, ...expansion } as never)).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      }
    }
  });
});
