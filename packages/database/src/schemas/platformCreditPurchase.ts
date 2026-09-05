import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { platformCreditEntries } from './platformCredit';
import { users } from './user';

export type PlatformCreditPurchaseStatus =
  | 'cancelled'
  | 'created'
  | 'credited'
  | 'expired'
  | 'payment_failed'
  | 'payment_pending'
  | 'paid'
  | 'review_required';

export type PlatformCreditPurchaseRefundStatus =
  'none' | 'requested' | 'review_required' | 'refunded';

export type PlatformCreditPaymentEventStatus = 'accepted' | 'review_required';

export const platformCreditPurchaseOrders = pgTable(
  'platform_credit_purchase_orders',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    /** Public, non-sequential identity sent to a future payment provider. */
    merchantOrderId: text('merchant_order_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Preserves ownership and idempotency after account deletion. */
    userIdSnapshot: text('user_id_snapshot').notNull(),
    /** Immutable server-owned quote snapshot. */
    productId: text('product_id').notNull(),
    credits: bigint('credits', { mode: 'number' }).notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: text('status').$type<PlatformCreditPurchaseStatus>().default('created').notNull(),
    refundStatus: text('refund_status')
      .$type<PlatformCreditPurchaseRefundStatus>()
      .default('none')
      .notNull(),
    version: bigint('version', { mode: 'number' }).default(1).notNull(),
    paymentProvider: text('payment_provider'),
    providerPaymentId: text('provider_payment_id'),
    creditEntryId: uuid('credit_entry_id').references(() => platformCreditEntries.id, {
      onDelete: 'restrict',
    }),
    expiresAt: timestamptz('expires_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('platform_credit_purchase_orders_merchant_order_unique').on(table.merchantOrderId),
    uniqueIndex('platform_credit_purchase_orders_user_idempotency_unique').on(
      table.userIdSnapshot,
      table.idempotencyKey,
    ),
    uniqueIndex('platform_credit_purchase_orders_credit_entry_unique')
      .on(table.creditEntryId)
      .where(sql`${table.creditEntryId} IS NOT NULL`),
    uniqueIndex('platform_credit_purchase_orders_provider_payment_unique')
      .on(table.paymentProvider, table.providerPaymentId)
      .where(sql`${table.paymentProvider} IS NOT NULL AND ${table.providerPaymentId} IS NOT NULL`),
    index('platform_credit_purchase_orders_user_created_at_idx').on(
      table.userIdSnapshot,
      table.createdAt,
    ),
    check(
      'platform_credit_purchase_orders_status_valid',
      sql`${table.status} IN ('created', 'payment_pending', 'payment_failed', 'paid', 'credited', 'cancelled', 'expired', 'review_required')`,
    ),
    check(
      'platform_credit_purchase_orders_refund_status_valid',
      sql`${table.refundStatus} IN ('none', 'requested', 'review_required', 'refunded')`,
    ),
    check(
      'platform_credit_purchase_orders_amounts_positive',
      sql`${table.credits} > 0 AND ${table.amountMinor} > 0`,
    ),
    check('platform_credit_purchase_orders_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check('platform_credit_purchase_orders_version_positive', sql`${table.version} > 0`),
    check(
      'platform_credit_purchase_orders_credit_entry_consistent',
      sql`(${table.status} = 'credited' AND ${table.creditEntryId} IS NOT NULL)
        OR (${table.status} <> 'credited' AND ${table.creditEntryId} IS NULL)`,
    ),
    check(
      'platform_credit_purchase_orders_payment_identity_complete',
      sql`${table.status} NOT IN ('paid', 'credited') OR (
        ${table.paymentProvider} IS NOT NULL
        AND length(trim(${table.paymentProvider})) > 0
        AND ${table.providerPaymentId} IS NOT NULL
        AND length(trim(${table.providerPaymentId})) > 0
      )`,
    ),
    check(
      'platform_credit_purchase_orders_unpaid_identity_empty',
      sql`${table.status} NOT IN ('created', 'payment_pending', 'cancelled', 'expired', 'payment_failed')
        OR (${table.paymentProvider} IS NULL AND ${table.providerPaymentId} IS NULL)`,
    ),
    check(
      'platform_credit_purchase_orders_identity_non_empty',
      sql`
      length(trim(${table.merchantOrderId})) > 0
      AND length(trim(${table.userIdSnapshot})) > 0
      AND length(trim(${table.productId})) > 0
      AND length(trim(${table.idempotencyKey})) > 0
    `,
    ),
  ],
);

export const platformCreditPaymentEvents = pgTable(
  'platform_credit_payment_events',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    orderId: uuid('order_id').references(() => platformCreditPurchaseOrders.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    merchantOrderId: text('merchant_order_id').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    processingStatus: text('processing_status').$type<PlatformCreditPaymentEventStatus>().notNull(),
    reviewReason: text('review_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('platform_credit_payment_events_provider_event_unique').on(
      table.provider,
      table.eventId,
    ),
    uniqueIndex('platform_credit_payment_events_provider_payment_unique').on(
      table.provider,
      table.providerPaymentId,
    ),
    index('platform_credit_payment_events_order_created_at_idx').on(table.orderId, table.createdAt),
    check(
      'platform_credit_payment_events_status_valid',
      sql`${table.processingStatus} IN ('accepted', 'review_required')`,
    ),
    check('platform_credit_payment_events_amount_positive', sql`${table.amountMinor} > 0`),
    check('platform_credit_payment_events_currency_valid', sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      'platform_credit_payment_events_identity_non_empty',
      sql`
      length(trim(${table.provider})) > 0
      AND length(trim(${table.eventId})) > 0
      AND length(trim(${table.eventType})) > 0
      AND length(trim(${table.providerPaymentId})) > 0
      AND length(trim(${table.merchantOrderId})) > 0
    `,
    ),
  ],
);

export type PlatformCreditPaymentEventItem = typeof platformCreditPaymentEvents.$inferSelect;
export type PlatformCreditPurchaseOrderItem = typeof platformCreditPurchaseOrders.$inferSelect;
