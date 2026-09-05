import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { chatGroups } from './chatGroup';
import { travelServiceOrders } from './serviceLedger';
import { users } from './user';
import { workspaces } from './workspace';

export const travelGenerationTasks = pgTable(
  'travel_generation_tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('travelGenerationTasks'))
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .references(() => chatGroups.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: uuid('order_id').references(() => travelServiceOrders.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    status: text('status').notNull(),
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash'),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    artifacts: jsonb('artifacts').$type<unknown[]>(),
    usage: jsonb('usage').$type<Record<string, number | undefined>>(),
    provider: text('provider'),
    code: text('code'),
    message: text('message'),
    ...timestamps,
  },
  (t) => [
    index('travel_generation_tasks_user_id_idx').on(t.userId),
    index('travel_generation_tasks_group_id_idx').on(t.groupId),
    index('travel_generation_tasks_order_id_idx').on(t.orderId),
    index('travel_generation_tasks_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('travel_generation_tasks_personal_idempotency_unique')
      .on(t.userId, t.groupId, t.type, t.idempotencyKey)
      .where(sql`${t.workspaceId} IS NULL AND ${t.idempotencyKey} IS NOT NULL`),
    uniqueIndex('travel_generation_tasks_workspace_idempotency_unique')
      .on(t.userId, t.workspaceId, t.groupId, t.type, t.idempotencyKey)
      .where(sql`${t.workspaceId} IS NOT NULL AND ${t.idempotencyKey} IS NOT NULL`),
  ],
);

export type TravelGenerationTaskItem = typeof travelGenerationTasks.$inferSelect;
