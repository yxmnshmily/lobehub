// @vitest-environment node
import type { ModelUsage } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  chatGroups,
  travelGenerationTasks,
  travelServiceAccounts,
  travelServiceOrders,
  users,
} from '..';

const serverDB = await getTestDB();
const userId = 'travel-generation-schema-test-user';
const groupId = 'travel-generation-schema-test-group';
const accountId = '00000000-0000-4000-8000-000000000011';
const orderId = '00000000-0000-4000-8000-000000000012';

beforeEach(async () => {
  await serverDB.delete(travelServiceAccounts).where(eq(travelServiceAccounts.id, accountId));
  await serverDB.delete(users).where(eq(users.id, userId));
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(chatGroups).values({ id: groupId, title: 'Travel generation', userId });
  await serverDB.insert(travelServiceAccounts).values({
    id: accountId,
    userId,
    userIdSnapshot: userId,
  });
  await serverDB.insert(travelServiceOrders).values({
    accountId,
    amountFen: 8800,
    id: orderId,
    idempotencyKey: 'travel-generation-order-link',
    title: '桂林旅游文案',
    userId,
  });
});

afterEach(async () => {
  await serverDB.delete(travelServiceAccounts).where(eq(travelServiceAccounts.id, accountId));
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('travelGenerationTasks schema', () => {
  it.each<ModelUsage>([
    { cost: 0.12, totalTokens: 100 },
    {
      cost: 0.12,
      costExchangeRate: {
        rate: 7.1,
        rateDate: '2026-09-01',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
      totalTokens: 100,
    },
  ])('preserves token costs and any historical exchange-rate snapshot', async (usage) => {
    const [task] = await serverDB
      .insert(travelGenerationTasks)
      .values({ groupId, input: {}, status: 'succeeded', type: 'copy', usage, userId })
      .returning({ id: travelGenerationTasks.id });
    const [persisted] = await serverDB
      .select({ usage: travelGenerationTasks.usage })
      .from(travelGenerationTasks)
      .where(eq(travelGenerationTasks.id, task.id));

    expect(persisted.usage).toEqual(usage);
  });

  it('generates an application-side id when inserting a task', async () => {
    const [task] = await serverDB
      .insert(travelGenerationTasks)
      .values({
        groupId,
        input: { prompt: 'Write a short travel caption' },
        status: 'pending',
        type: 'copy',
        userId,
      })
      .returning();

    expect(task.id).toMatch(/^tgt_[\dA-Za-z]{12}$/);
  });

  it('persists the service order link used to charge the generation task', async () => {
    const [task] = await serverDB
      .insert(travelGenerationTasks)
      .values({
        groupId,
        input: { prompt: '写一篇桂林旅游文案' },
        orderId,
        status: 'queued',
        type: 'copy',
        userId,
      })
      .returning();

    expect(task.orderId).toBe(orderId);
  });
});
