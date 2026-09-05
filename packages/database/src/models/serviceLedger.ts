import { and, desc, eq } from 'drizzle-orm';

import {
  type TravelServiceAccountItem,
  travelServiceAccounts,
  travelServiceLedgerEntries,
  type TravelServiceLedgerEntryItem,
  travelServiceOrders,
  type TravelServiceOrderStatus,
  users,
} from '../schemas';
import type { LobeChatDatabase } from '../type';

export const SERVICE_LEDGER_INVALID_AMOUNT = '金额必须是非零整数分';
export const SERVICE_LEDGER_INSUFFICIENT_BALANCE = '服务余额不足';
export const SERVICE_LEDGER_ENTRY_NOT_FOUND = '账本流水不存在';
export const SERVICE_LEDGER_ENTRY_ALREADY_REVERSED = '账本流水已冲正';
export const SERVICE_LEDGER_REVERSAL_NOT_REVERSIBLE = '冲正流水不能再次冲正';
export const SERVICE_LEDGER_IDEMPOTENCY_CONFLICT = '幂等键已用于其他账务操作';
export const SERVICE_LEDGER_ORDER_NOT_FOUND = '服务订单不存在';
export const SERVICE_LEDGER_ORDER_NOT_PENDING = '服务订单不是待执行状态';
export const SERVICE_LEDGER_ORDER_NOT_RESERVED = '服务订单尚未预扣';

const MAX_AMOUNT_FEN = 2_000_000_000;

const assertAmount = (amountFen: number, allowNegative = true) => {
  if (
    !Number.isInteger(amountFen) ||
    amountFen === 0 ||
    Math.abs(amountFen) > MAX_AMOUNT_FEN ||
    (!allowNegative && amountFen < 0)
  ) {
    throw new Error(SERVICE_LEDGER_INVALID_AMOUNT);
  }
};

const normalizeRequiredText = (value: string, field: string, maxLength: number): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${field}无效`);
  return normalized;
};

const ensureAccount = async (
  db: LobeChatDatabase,
  userId: string,
  lock = false,
): Promise<TravelServiceAccountItem> => {
  await db
    .insert(travelServiceAccounts)
    .values({ userId, userIdSnapshot: userId })
    .onConflictDoNothing({ target: travelServiceAccounts.userId });

  const query = db
    .select()
    .from(travelServiceAccounts)
    .where(eq(travelServiceAccounts.userId, userId))
    .limit(1);
  const [account] = lock ? await query.for('update') : await query;
  if (!account) throw new Error('无法创建服务账户');
  return account;
};

interface CreateServiceOrderInput {
  amountFen: number;
  idempotencyKey: string;
  status?: TravelServiceOrderStatus;
  title: string;
}

const createServiceOrder = async (
  db: LobeChatDatabase,
  userId: string,
  input: CreateServiceOrderInput,
) => {
  assertAmount(input.amountFen, false);
  const title = normalizeRequiredText(input.title, '订单标题', 200);
  const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 128);
  const status = input.status ?? 'pending';

  return db.transaction(async (tx) => {
    const transaction = tx as LobeChatDatabase;
    const account = await ensureAccount(transaction, userId, true);
    const [existing] = await transaction
      .select()
      .from(travelServiceOrders)
      .where(
        and(
          eq(travelServiceOrders.accountId, account.id),
          eq(travelServiceOrders.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.amountFen !== input.amountFen ||
        existing.status !== status ||
        existing.title !== title
      ) {
        throw new Error(SERVICE_LEDGER_IDEMPOTENCY_CONFLICT);
      }
      return existing;
    }

    const [order] = await transaction
      .insert(travelServiceOrders)
      .values({
        accountId: account.id,
        amountFen: input.amountFen,
        idempotencyKey,
        status,
        title,
        userId,
      })
      .returning();
    return order;
  });
};

export class TravelServiceLedgerModel {
  constructor(
    protected readonly db: LobeChatDatabase,
    protected readonly userId: string,
  ) {}

  getAccount = () => ensureAccount(this.db, this.userId);

  listEntries = (limit = 100) =>
    this.db
      .select()
      .from(travelServiceLedgerEntries)
      .where(eq(travelServiceLedgerEntries.userId, this.userId))
      .orderBy(desc(travelServiceLedgerEntries.createdAt), desc(travelServiceLedgerEntries.id))
      .limit(limit);

  listOrders = (limit = 100) =>
    this.db
      .select()
      .from(travelServiceOrders)
      .where(eq(travelServiceOrders.userId, this.userId))
      .orderBy(desc(travelServiceOrders.createdAt), desc(travelServiceOrders.id))
      .limit(limit);

  createOrder = (input: CreateServiceOrderInput) => createServiceOrder(this.db, this.userId, input);

  async reserveOrder(input: {
    idempotencyKey: string;
    orderId: string;
  }): Promise<TravelServiceLedgerEntryItem> {
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 128);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [order] = await transaction
        .select()
        .from(travelServiceOrders)
        .where(
          and(
            eq(travelServiceOrders.id, input.orderId),
            eq(travelServiceOrders.userId, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!order) throw new Error(SERVICE_LEDGER_ORDER_NOT_FOUND);

      const [existingCharge] = await transaction
        .select()
        .from(travelServiceLedgerEntries)
        .where(
          and(
            eq(travelServiceLedgerEntries.orderId, order.id),
            eq(travelServiceLedgerEntries.type, 'service_charge'),
          ),
        )
        .limit(1);
      if (existingCharge) {
        if (existingCharge.idempotencyKey !== idempotencyKey) {
          throw new Error(SERVICE_LEDGER_IDEMPOTENCY_CONFLICT);
        }
        return existingCharge;
      }
      if (order.status !== 'pending') throw new Error(SERVICE_LEDGER_ORDER_NOT_PENDING);

      const [account] = await transaction
        .select()
        .from(travelServiceAccounts)
        .where(eq(travelServiceAccounts.id, order.accountId))
        .limit(1)
        .for('update');
      if (!account) throw new Error(SERVICE_LEDGER_ORDER_NOT_FOUND);
      const balanceAfterFen = account.balanceFen - order.amountFen;
      if (balanceAfterFen < 0) throw new Error(SERVICE_LEDGER_INSUFFICIENT_BALANCE);

      const [entry] = await transaction
        .insert(travelServiceLedgerEntries)
        .values({
          accountId: account.id,
          amountFen: -order.amountFen,
          balanceAfterFen,
          idempotencyKey,
          orderId: order.id,
          reason: `服务预扣：${order.title}`,
          type: 'service_charge',
          userId: this.userId,
        })
        .returning();
      await transaction
        .update(travelServiceAccounts)
        .set({ balanceFen: balanceAfterFen, updatedAt: new Date() })
        .where(eq(travelServiceAccounts.id, account.id));
      return entry;
    });
  }

  async completeOrder(orderId: string) {
    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [order] = await transaction
        .select()
        .from(travelServiceOrders)
        .where(
          and(eq(travelServiceOrders.id, orderId), eq(travelServiceOrders.userId, this.userId)),
        )
        .limit(1)
        .for('update');
      if (!order) throw new Error(SERVICE_LEDGER_ORDER_NOT_FOUND);
      if (order.status === 'completed') return order;
      if (order.status !== 'pending') throw new Error(SERVICE_LEDGER_ORDER_NOT_PENDING);

      const [charge] = await transaction
        .select({ id: travelServiceLedgerEntries.id })
        .from(travelServiceLedgerEntries)
        .where(
          and(
            eq(travelServiceLedgerEntries.orderId, order.id),
            eq(travelServiceLedgerEntries.type, 'service_charge'),
          ),
        )
        .limit(1);
      if (!charge) throw new Error(SERVICE_LEDGER_ORDER_NOT_RESERVED);

      const [completed] = await transaction
        .update(travelServiceOrders)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(travelServiceOrders.id, order.id))
        .returning();
      return completed;
    });
  }

  async refundOrder(input: {
    idempotencyKey: string;
    orderId: string;
  }): Promise<TravelServiceLedgerEntryItem> {
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 128);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [order] = await transaction
        .select()
        .from(travelServiceOrders)
        .where(
          and(
            eq(travelServiceOrders.id, input.orderId),
            eq(travelServiceOrders.userId, this.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!order) throw new Error(SERVICE_LEDGER_ORDER_NOT_FOUND);

      const [charge] = await transaction
        .select()
        .from(travelServiceLedgerEntries)
        .where(
          and(
            eq(travelServiceLedgerEntries.orderId, order.id),
            eq(travelServiceLedgerEntries.type, 'service_charge'),
          ),
        )
        .limit(1);
      if (!charge) throw new Error(SERVICE_LEDGER_ORDER_NOT_RESERVED);

      const [existingRefund] = await transaction
        .select()
        .from(travelServiceLedgerEntries)
        .where(eq(travelServiceLedgerEntries.reversalOfEntryId, charge.id))
        .limit(1);
      if (existingRefund) {
        if (existingRefund.idempotencyKey !== idempotencyKey) {
          throw new Error(SERVICE_LEDGER_IDEMPOTENCY_CONFLICT);
        }
        return existingRefund;
      }
      if (order.status !== 'pending') throw new Error(SERVICE_LEDGER_ORDER_NOT_PENDING);

      const [account] = await transaction
        .select()
        .from(travelServiceAccounts)
        .where(eq(travelServiceAccounts.id, order.accountId))
        .limit(1)
        .for('update');
      if (!account) throw new Error(SERVICE_LEDGER_ORDER_NOT_FOUND);
      const amountFen = -charge.amountFen;
      const balanceAfterFen = account.balanceFen + amountFen;

      const [entry] = await transaction
        .insert(travelServiceLedgerEntries)
        .values({
          accountId: account.id,
          amountFen,
          balanceAfterFen,
          idempotencyKey,
          orderId: order.id,
          reason: `服务失败回退：${order.title}`,
          reversalOfEntryId: charge.id,
          type: 'reversal',
          userId: this.userId,
        })
        .returning();
      await transaction
        .update(travelServiceAccounts)
        .set({ balanceFen: balanceAfterFen, updatedAt: new Date() })
        .where(eq(travelServiceAccounts.id, account.id));
      await transaction
        .update(travelServiceOrders)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(eq(travelServiceOrders.id, order.id));
      return entry;
    });
  }
}

export interface PostManualEntryInput {
  amountFen: number;
  idempotencyKey: string;
  reason: string;
  targetUserId: string;
}

export interface ReverseEntryInput {
  entryId: string;
  idempotencyKey: string;
  reason: string;
}

export class TravelServiceLedgerAdminModel {
  constructor(
    protected readonly db: LobeChatDatabase,
    protected readonly userId: string,
  ) {}

  async postManualEntry(input: PostManualEntryInput): Promise<TravelServiceLedgerEntryItem> {
    assertAmount(input.amountFen);
    const reason = normalizeRequiredText(input.reason, '原因', 500);
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 128);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const account = await ensureAccount(transaction, input.targetUserId, true);
      const [existing] = await transaction
        .select()
        .from(travelServiceLedgerEntries)
        .where(
          and(
            eq(travelServiceLedgerEntries.accountId, account.id),
            eq(travelServiceLedgerEntries.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.amountFen !== input.amountFen ||
          existing.reason !== reason ||
          existing.type !== 'manual_adjustment'
        ) {
          throw new Error(SERVICE_LEDGER_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }

      const balanceAfterFen = account.balanceFen + input.amountFen;
      if (balanceAfterFen < 0) throw new Error(SERVICE_LEDGER_INSUFFICIENT_BALANCE);

      const [entry] = await transaction
        .insert(travelServiceLedgerEntries)
        .values({
          accountId: account.id,
          amountFen: input.amountFen,
          balanceAfterFen,
          idempotencyKey,
          operatorUserId: this.userId,
          reason,
          type: 'manual_adjustment',
          userId: input.targetUserId,
        })
        .returning();
      await transaction
        .update(travelServiceAccounts)
        .set({ balanceFen: balanceAfterFen, updatedAt: new Date() })
        .where(eq(travelServiceAccounts.id, account.id));
      return entry;
    });
  }

  async reverseEntry(input: ReverseEntryInput): Promise<TravelServiceLedgerEntryItem> {
    const reason = normalizeRequiredText(input.reason, '原因', 500);
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 128);

    return this.db.transaction(async (tx) => {
      const transaction = tx as LobeChatDatabase;
      const [original] = await transaction
        .select()
        .from(travelServiceLedgerEntries)
        .where(eq(travelServiceLedgerEntries.id, input.entryId))
        .limit(1);
      if (!original) throw new Error(SERVICE_LEDGER_ENTRY_NOT_FOUND);
      if (original.type === 'reversal') throw new Error(SERVICE_LEDGER_REVERSAL_NOT_REVERSIBLE);

      if (original.orderId) {
        await transaction
          .select({ id: travelServiceOrders.id })
          .from(travelServiceOrders)
          .where(eq(travelServiceOrders.id, original.orderId))
          .limit(1)
          .for('update');
      }

      const [account] = await transaction
        .select()
        .from(travelServiceAccounts)
        .where(eq(travelServiceAccounts.id, original.accountId))
        .limit(1)
        .for('update');
      if (!account) throw new Error(SERVICE_LEDGER_ENTRY_NOT_FOUND);

      const [existingByKey] = await transaction
        .select()
        .from(travelServiceLedgerEntries)
        .where(
          and(
            eq(travelServiceLedgerEntries.accountId, account.id),
            eq(travelServiceLedgerEntries.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existingByKey) {
        if (
          existingByKey.type !== 'reversal' ||
          existingByKey.reversalOfEntryId !== original.id ||
          existingByKey.reason !== reason
        ) {
          throw new Error(SERVICE_LEDGER_IDEMPOTENCY_CONFLICT);
        }
        return existingByKey;
      }

      const [existingReversal] = await transaction
        .select({ id: travelServiceLedgerEntries.id })
        .from(travelServiceLedgerEntries)
        .where(eq(travelServiceLedgerEntries.reversalOfEntryId, original.id))
        .limit(1);
      if (existingReversal) throw new Error(SERVICE_LEDGER_ENTRY_ALREADY_REVERSED);

      const amountFen = -original.amountFen;
      const balanceAfterFen = account.balanceFen + amountFen;
      if (balanceAfterFen < 0) throw new Error(SERVICE_LEDGER_INSUFFICIENT_BALANCE);

      const [entry] = await transaction
        .insert(travelServiceLedgerEntries)
        .values({
          accountId: account.id,
          amountFen,
          balanceAfterFen,
          idempotencyKey,
          operatorUserId: this.userId,
          orderId: original.orderId,
          reason,
          reversalOfEntryId: original.id,
          type: 'reversal',
          userId: original.userId,
        })
        .returning();
      await transaction
        .update(travelServiceAccounts)
        .set({ balanceFen: balanceAfterFen, updatedAt: new Date() })
        .where(eq(travelServiceAccounts.id, account.id));
      if (original.orderId) {
        await transaction
          .update(travelServiceOrders)
          .set({ status: 'refunded', updatedAt: new Date() })
          .where(eq(travelServiceOrders.id, original.orderId));
      }
      return entry;
    });
  }

  async createOrder(input: {
    amountFen: number;
    idempotencyKey: string;
    status?: TravelServiceOrderStatus;
    targetUserId: string;
    title: string;
  }) {
    return createServiceOrder(this.db, input.targetUserId, input);
  }

  listAccounts = (limit = 100) =>
    this.db
      .select({
        account: travelServiceAccounts,
        user: {
          banned: users.banned,
          email: users.email,
          fullName: users.fullName,
          id: users.id,
          username: users.username,
        },
      })
      .from(travelServiceAccounts)
      .leftJoin(users, eq(travelServiceAccounts.userId, users.id))
      .orderBy(desc(travelServiceAccounts.updatedAt), desc(travelServiceAccounts.id))
      .limit(limit);

  listAllEntries = (limit = 200) =>
    this.db
      .select()
      .from(travelServiceLedgerEntries)
      .orderBy(desc(travelServiceLedgerEntries.createdAt), desc(travelServiceLedgerEntries.id))
      .limit(limit);

  listAllOrders = (limit = 200) =>
    this.db
      .select()
      .from(travelServiceOrders)
      .orderBy(desc(travelServiceOrders.createdAt), desc(travelServiceOrders.id))
      .limit(limit);
}
