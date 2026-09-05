import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';

export type TravelServiceLedgerEntryType = 'manual_adjustment' | 'reversal' | 'service_charge';
export type TravelServiceOrderStatus = 'cancelled' | 'completed' | 'pending' | 'refunded';

export const travelServiceAccounts = pgTable(
  'travel_service_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userIdSnapshot: text('user_id_snapshot').notNull(),
    currency: text('currency').default('CNY').notNull(),
    balanceFen: integer('balance_fen').default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('travel_service_accounts_user_id_unique').on(table.userId),
    check('travel_service_accounts_currency_cny', sql`${table.currency} = 'CNY'`),
    check('travel_service_accounts_balance_non_negative', sql`${table.balanceFen} >= 0`),
  ],
);

export const travelServiceOrders = pgTable(
  'travel_service_orders',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    accountId: uuid('account_id')
      .references(() => travelServiceAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: text('idempotency_key').notNull(),
    title: text('title').notNull(),
    amountFen: integer('amount_fen').notNull(),
    status: text('status').$type<TravelServiceOrderStatus>().default('pending').notNull(),
    ...timestamps,
  },
  (table) => [
    index('travel_service_orders_user_created_at_idx').on(table.userId, table.createdAt),
    index('travel_service_orders_account_id_idx').on(table.accountId),
    uniqueIndex('travel_service_orders_account_idempotency_unique').on(
      table.accountId,
      table.idempotencyKey,
    ),
    check('travel_service_orders_amount_positive', sql`${table.amountFen} > 0`),
    check(
      'travel_service_orders_status_valid',
      sql`${table.status} IN ('pending', 'completed', 'cancelled', 'refunded')`,
    ),
  ],
);

export const travelServiceLedgerEntries = pgTable(
  'travel_service_ledger_entries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    accountId: uuid('account_id')
      .references(() => travelServiceAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    operatorUserId: text('operator_user_id').references(() => users.id, { onDelete: 'set null' }),
    orderId: uuid('order_id').references(() => travelServiceOrders.id, { onDelete: 'set null' }),
    reversalOfEntryId: uuid('reversal_of_entry_id').references(
      (): AnyPgColumn => travelServiceLedgerEntries.id,
      { onDelete: 'restrict' },
    ),
    type: text('type').$type<TravelServiceLedgerEntryType>().notNull(),
    amountFen: integer('amount_fen').notNull(),
    balanceAfterFen: integer('balance_after_fen').notNull(),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('travel_service_ledger_entries_account_idempotency_unique').on(
      table.accountId,
      table.idempotencyKey,
    ),
    uniqueIndex('travel_service_ledger_entries_reversal_once_unique')
      .on(table.reversalOfEntryId)
      .where(sql`${table.reversalOfEntryId} IS NOT NULL`),
    index('travel_service_ledger_entries_user_created_at_idx').on(table.userId, table.createdAt),
    index('travel_service_ledger_entries_account_id_idx').on(table.accountId),
    index('travel_service_ledger_entries_order_id_idx').on(table.orderId),
    check('travel_service_ledger_entries_amount_non_zero', sql`${table.amountFen} <> 0`),
    check('travel_service_ledger_entries_balance_non_negative', sql`${table.balanceAfterFen} >= 0`),
    check('travel_service_ledger_entries_reason_non_empty', sql`length(trim(${table.reason})) > 0`),
    check(
      'travel_service_ledger_entries_type_valid',
      sql`${table.type} IN ('manual_adjustment', 'reversal', 'service_charge')`,
    ),
  ],
);

export type TravelServiceAccountItem = typeof travelServiceAccounts.$inferSelect;
export type TravelServiceLedgerEntryItem = typeof travelServiceLedgerEntries.$inferSelect;
export type TravelServiceOrderItem = typeof travelServiceOrders.$inferSelect;
