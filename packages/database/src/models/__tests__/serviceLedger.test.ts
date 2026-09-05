// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  travelServiceAccounts,
  travelServiceLedgerEntries,
  travelServiceOrders,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TravelServiceLedgerAdminModel, TravelServiceLedgerModel } from '../serviceLedger';

const db: LobeChatDatabase = await getTestDB();
const userA = 'service-ledger-user-a';
const userB = 'service-ledger-user-b';
const adminId = 'service-ledger-admin';

const cleanup = async () => {
  await db.delete(travelServiceLedgerEntries);
  await db.delete(travelServiceOrders);
  await db.delete(travelServiceAccounts);
  await db.delete(users).where(eq(users.id, userA));
  await db.delete(users).where(eq(users.id, userB));
  await db.delete(users).where(eq(users.id, adminId));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([
    { fullName: '客户 A', id: userA },
    { fullName: '客户 B', id: userB },
    { fullName: '管理员', id: adminId },
  ]);
});

afterEach(cleanup);

describe('TravelServiceLedgerModel', () => {
  it('creates one zero-balance CNY account and isolates two customers', async () => {
    const modelA = new TravelServiceLedgerModel(db, userA);
    const modelB = new TravelServiceLedgerModel(db, userB);

    await expect(modelA.getAccount()).resolves.toMatchObject({ balanceFen: 0, currency: 'CNY' });
    await expect(modelA.getAccount()).resolves.toMatchObject({ balanceFen: 0, currency: 'CNY' });
    await expect(modelB.getAccount()).resolves.toMatchObject({ balanceFen: 0, currency: 'CNY' });

    expect(await db.select().from(travelServiceAccounts)).toHaveLength(2);
    await expect(modelA.listEntries()).resolves.toEqual([]);
    await expect(modelA.listOrders()).resolves.toEqual([]);
  });

  it('returns only the current customer entries and orders', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 12_300,
      idempotencyKey: 'credit-a',
      reason: '线下汇款核对',
      targetUserId: userA,
    });
    await admin.postManualEntry({
      amountFen: 45_600,
      idempotencyKey: 'credit-b',
      reason: '线下汇款核对',
      targetUserId: userB,
    });
    await admin.createOrder({
      amountFen: 5_000,
      idempotencyKey: 'order-a',
      targetUserId: userA,
      title: '行程策划服务',
    });
    await admin.createOrder({
      amountFen: 9_000,
      idempotencyKey: 'order-b',
      targetUserId: userB,
      title: '定制视频服务',
    });

    const modelA = new TravelServiceLedgerModel(db, userA);
    expect((await modelA.listEntries()).map((entry) => entry.amountFen)).toEqual([12_300]);
    expect((await modelA.listOrders()).map((order) => order.title)).toEqual(['行程策划服务']);
  });

  it('creates an idempotent order only for the current customer', async () => {
    const modelA = new TravelServiceLedgerModel(db, userA);
    const input = {
      amountFen: 1280,
      idempotencyKey: 'website-image:operation-1:tool-1',
      title: '旅游图片制作',
    };

    const first = await modelA.createOrder(input);
    const repeated = await modelA.createOrder(input);

    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({ amountFen: 1280, status: 'pending', userId: userA });
    await expect(modelA.listOrders()).resolves.toEqual([expect.objectContaining({ id: first.id })]);
    await expect(new TravelServiceLedgerModel(db, userB).listOrders()).resolves.toEqual([]);
    await expect(modelA.createOrder({ ...input, amountFen: 2280 })).rejects.toThrow(
      '幂等键已用于其他账务操作',
    );
  });

  it('applies a concurrent idempotent manual entry exactly once', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    const input = {
      amountFen: 20_000,
      idempotencyKey: 'manual-credit-once',
      reason: '对公转账已确认',
      targetUserId: userA,
    };

    const [first, second] = await Promise.all([
      admin.postManualEntry(input),
      admin.postManualEntry(input),
    ]);

    expect(first.id).toBe(second.id);
    await expect(new TravelServiceLedgerModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceFen: 20_000,
    });
    expect(await db.select().from(travelServiceLedgerEntries)).toHaveLength(1);
  });

  it('rejects non-integer amounts and a debit that would make balance negative', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);

    await expect(
      admin.postManualEntry({
        amountFen: 1.5,
        idempotencyKey: 'fractional',
        reason: '非法小数金额',
        targetUserId: userA,
      }),
    ).rejects.toThrow('金额必须是非零整数分');

    await expect(
      admin.postManualEntry({
        amountFen: -1,
        idempotencyKey: 'negative',
        reason: '试图负余额',
        targetUserId: userA,
      }),
    ).rejects.toThrow('服务余额不足');
  });

  it('reverses an entry once with a reason and idempotency key', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    const original = await admin.postManualEntry({
      amountFen: 30_000,
      idempotencyKey: 'credit-to-reverse',
      reason: '原始入账',
      targetUserId: userA,
    });

    const reversal = await admin.reverseEntry({
      entryId: original.id,
      idempotencyKey: 'reverse-once',
      reason: '原始入账记录有误',
    });
    const repeated = await admin.reverseEntry({
      entryId: original.id,
      idempotencyKey: 'reverse-once',
      reason: '原始入账记录有误',
    });

    expect(reversal.id).toBe(repeated.id);
    expect(reversal.amountFen).toBe(-30_000);
    await expect(new TravelServiceLedgerModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceFen: 0,
    });
  });

  it('creates one order for concurrent retries with the same idempotency key', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    const input = {
      amountFen: 15_800,
      idempotencyKey: 'order-once',
      targetUserId: userA,
      title: '定制行程服务',
    };

    const [first, repeated] = await Promise.all([
      admin.createOrder(input),
      admin.createOrder(input),
    ]);

    expect(repeated.id).toBe(first.id);
    expect(await db.select().from(travelServiceOrders)).toHaveLength(1);
    await expect(admin.createOrder({ ...input, amountFen: 16_800 })).rejects.toThrow(
      '幂等键已用于其他账务操作',
    );
  });

  it('reserves the exact existing order amount and completes it idempotently', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 20_000,
      idempotencyKey: 'generation-credit',
      reason: '旅游服务预存',
      targetUserId: userA,
    });
    const order = await admin.createOrder({
      amountFen: 8_800,
      idempotencyKey: 'generation-order',
      targetUserId: userA,
      title: '桂林旅游文案',
    });
    const ledger = new TravelServiceLedgerModel(db, userA);

    const first = await ledger.reserveOrder({
      idempotencyKey: 'travel-generation:task-1:reserve',
      orderId: order.id,
    });
    const repeated = await ledger.reserveOrder({
      idempotencyKey: 'travel-generation:task-1:reserve',
      orderId: order.id,
    });

    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      amountFen: -8_800,
      orderId: order.id,
      type: 'service_charge',
    });
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceFen: 11_200 });
    await expect(ledger.completeOrder(order.id)).resolves.toMatchObject({ status: 'completed' });
    await expect(ledger.completeOrder(order.id)).resolves.toMatchObject({ status: 'completed' });
  });

  it('refunds a reserved generation order exactly once after failure', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 20_000,
      idempotencyKey: 'refund-credit',
      reason: '旅游服务预存',
      targetUserId: userA,
    });
    const order = await admin.createOrder({
      amountFen: 12_800,
      idempotencyKey: 'refund-order',
      targetUserId: userA,
      title: '桂林旅游视频',
    });
    const ledger = new TravelServiceLedgerModel(db, userA);
    await ledger.reserveOrder({
      idempotencyKey: 'travel-generation:task-2:reserve',
      orderId: order.id,
    });

    const first = await ledger.refundOrder({
      idempotencyKey: 'travel-generation:task-2:refund',
      orderId: order.id,
    });
    const repeated = await ledger.refundOrder({
      idempotencyKey: 'travel-generation:task-2:refund',
      orderId: order.id,
    });

    expect(repeated.id).toBe(first.id);
    expect(first).toMatchObject({
      amountFen: 12_800,
      orderId: order.id,
      type: 'reversal',
    });
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceFen: 20_000 });
    await expect(ledger.listOrders()).resolves.toEqual([
      expect.objectContaining({ id: order.id, status: 'refunded' }),
    ]);
  });

  it('rejects a generation order reservation when balance is insufficient', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    const order = await admin.createOrder({
      amountFen: 8_800,
      idempotencyKey: 'insufficient-order',
      targetUserId: userA,
      title: '桂林旅游封面',
    });

    await expect(
      new TravelServiceLedgerModel(db, userA).reserveOrder({
        idempotencyKey: 'travel-generation:task-3:reserve',
        orderId: order.id,
      }),
    ).rejects.toThrow('服务余额不足');

    await expect(new TravelServiceLedgerModel(db, userA).getAccount()).resolves.toMatchObject({
      balanceFen: 0,
    });
  });

  it('rejects a service order owned by another customer', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 20_000,
      idempotencyKey: 'cross-customer-credit',
      reason: '旅游服务预存',
      targetUserId: userB,
    });
    const order = await admin.createOrder({
      amountFen: 8_800,
      idempotencyKey: 'cross-customer-order',
      targetUserId: userB,
      title: '客户 B 的旅游文案',
    });

    await expect(
      new TravelServiceLedgerModel(db, userA).reserveOrder({
        idempotencyKey: 'travel-generation:cross-customer:reserve',
        orderId: order.id,
      }),
    ).rejects.toThrow('服务订单不存在');

    await expect(new TravelServiceLedgerModel(db, userB).getAccount()).resolves.toMatchObject({
      balanceFen: 20_000,
    });
    expect(await db.select().from(travelServiceLedgerEntries)).toHaveLength(1);
  });

  it('allows only one concurrent task to reserve the same service order', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 20_000,
      idempotencyKey: 'concurrent-reserve-credit',
      reason: '旅游服务预存',
      targetUserId: userA,
    });
    const order = await admin.createOrder({
      amountFen: 8_800,
      idempotencyKey: 'concurrent-reserve-order',
      targetUserId: userA,
      title: '并发预扣验收',
    });
    const ledger = new TravelServiceLedgerModel(db, userA);

    const attempts = await Promise.allSettled([
      ledger.reserveOrder({
        idempotencyKey: 'travel-generation:concurrent-a:reserve',
        orderId: order.id,
      }),
      ledger.reserveOrder({
        idempotencyKey: 'travel-generation:concurrent-b:reserve',
        orderId: order.id,
      }),
    ]);

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(ledger.getAccount()).resolves.toMatchObject({ balanceFen: 11_200 });
    expect(
      (await ledger.listEntries()).filter(({ type }) => type === 'service_charge'),
    ).toHaveLength(1);
  });

  it('keeps the order and ledger consistent when an administrator reverses a service charge', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 20_000,
      idempotencyKey: 'admin-refund-credit',
      reason: '旅游服务预存',
      targetUserId: userA,
    });
    const order = await admin.createOrder({
      amountFen: 8_800,
      idempotencyKey: 'admin-refund-order',
      targetUserId: userA,
      title: '桂林旅游文案',
    });
    const ledger = new TravelServiceLedgerModel(db, userA);
    const charge = await ledger.reserveOrder({
      idempotencyKey: 'travel-generation:task-admin-refund:reserve',
      orderId: order.id,
    });

    const reversal = await admin.reverseEntry({
      entryId: charge.id,
      idempotencyKey: 'admin-service-charge-refund',
      reason: '管理员取消本次服务',
    });

    expect(reversal).toMatchObject({ orderId: order.id, reversalOfEntryId: charge.id });
    await expect(ledger.listOrders()).resolves.toEqual([
      expect.objectContaining({ id: order.id, status: 'refunded' }),
    ]);
    await expect(ledger.completeOrder(order.id)).rejects.toThrow('服务订单不是待执行状态');
  });

  it('rejects an attempt to reverse a reversal entry', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    const original = await admin.postManualEntry({
      amountFen: 30_000,
      idempotencyKey: 'credit-before-reversal',
      reason: '原始入账',
      targetUserId: userA,
    });
    const reversal = await admin.reverseEntry({
      entryId: original.id,
      idempotencyKey: 'first-reversal',
      reason: '原始入账作废',
    });

    await expect(
      admin.reverseEntry({
        entryId: reversal.id,
        idempotencyKey: 'reverse-the-reversal',
        reason: '不允许的二次冲正',
      }),
    ).rejects.toThrow('冲正流水不能再次冲正');
  });

  it('retains the account, orders, and ledger audit after its user is deleted', async () => {
    const admin = new TravelServiceLedgerAdminModel(db, adminId);
    await admin.postManualEntry({
      amountFen: 20_000,
      idempotencyKey: 'retained-credit',
      reason: '线下收款已核对',
      targetUserId: userA,
    });
    await admin.createOrder({
      amountFen: 8_000,
      idempotencyKey: 'retained-order',
      targetUserId: userA,
      title: '需保留的服务订单',
    });

    await db.delete(users).where(eq(users.id, userA));

    await expect(db.select().from(travelServiceAccounts)).resolves.toEqual([
      expect.objectContaining({ userId: null, userIdSnapshot: userA }),
    ]);
    await expect(db.select().from(travelServiceOrders)).resolves.toEqual([
      expect.objectContaining({ title: '需保留的服务订单', userId: null }),
    ]);
    await expect(db.select().from(travelServiceLedgerEntries)).resolves.toEqual([
      expect.objectContaining({ reason: '线下收款已核对', userId: null }),
    ]);
    await expect(admin.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        account: expect.objectContaining({ userIdSnapshot: userA }),
        user: null,
      }),
    ]);
  });
});
