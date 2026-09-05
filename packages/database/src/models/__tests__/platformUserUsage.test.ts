// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, chatGroups, messages, travelGenerationTasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { PLATFORM_USER_USAGE_TARGET_REQUIRED, PlatformUserUsageModel } from '../platformUserUsage';

const db: LobeChatDatabase = await getTestDB();
const targetUserId = 'platform-usage-target';
const otherUserId = 'platform-usage-other';
const userIds = [targetUserId, otherUserId];
const targetGroupId = 'platform-usage-target-group';
const otherGroupId = 'platform-usage-other-group';

const cleanup = async () => {
  await db.delete(travelGenerationTasks).where(inArray(travelGenerationTasks.userId, userIds));
  await db.delete(chatGroups).where(inArray(chatGroups.userId, userIds));
  await db.delete(messages).where(inArray(messages.userId, userIds));
  await db.delete(agentOperations).where(inArray(agentOperations.userId, userIds));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values([{ id: targetUserId }, { id: otherUserId }]);
  await db.insert(chatGroups).values([
    { id: targetGroupId, title: '目标群组', userId: targetUserId },
    { id: otherGroupId, title: '其他群组', userId: otherUserId },
  ]);

  await db.insert(messages).values([
    {
      content: 'MESSAGE_BODY_MUST_NOT_LEAK',
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      id: 'platform-usage-message-current',
      metadata: { privatePrompt: 'MESSAGE_METADATA_MUST_NOT_LEAK' },
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      usage: {
        cost: 0.002,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalTokens: 150,
      },
      userId: targetUserId,
    },
    {
      content: 'LEGACY_MESSAGE_BODY_MUST_NOT_LEAK',
      createdAt: new Date('2026-08-02T08:00:00.000Z'),
      id: 'platform-usage-message-legacy',
      metadata: {
        privatePrompt: 'LEGACY_METADATA_MUST_NOT_LEAK',
        usage: {
          cost: 0.003,
          totalInputTokens: 200,
          totalOutputTokens: 100,
          totalTokens: 300,
        },
      },
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      userId: targetUserId,
    },
    {
      createdAt: new Date('2026-08-06T08:00:00.000Z'),
      id: 'platform-usage-message-copy',
      metadata: {
        copied: true,
        usage: {
          cost: 99,
          totalInputTokens: 99_000,
          totalOutputTokens: 1000,
          totalTokens: 100_000,
        },
      },
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      userId: targetUserId,
    },
    {
      createdAt: new Date('2026-08-07T08:00:00.000Z'),
      id: 'platform-usage-user-message',
      model: 'gpt-5',
      provider: 'openai',
      role: 'user',
      usage: { cost: 88, totalTokens: 88_000 },
      userId: targetUserId,
    },
    {
      createdAt: new Date('2026-08-08T08:00:00.000Z'),
      id: 'platform-usage-other-message',
      model: 'gpt-5',
      provider: 'openai',
      role: 'assistant',
      usage: { cost: 77, totalTokens: 77_000 },
      userId: otherUserId,
    },
  ]);

  await db.insert(agentOperations).values([
    {
      completedAt: new Date('2026-08-04T08:00:00.000Z'),
      cost: { total: 0.01 },
      createdAt: new Date('2026-08-04T08:00:00.000Z'),
      currency: 'USD',
      id: 'platform-usage-operation-target',
      metadata: { prompt: 'OPERATION_METADATA_MUST_NOT_LEAK' },
      model: 'claude-sonnet-4',
      modelRuntimeConfig: { apiKey: 'OPERATION_API_KEY_MUST_NOT_LEAK' },
      provider: 'anthropic',
      status: 'done',
      totalCost: 0.01,
      totalInputTokens: 1000,
      totalOutputTokens: 300,
      totalTokens: 1300,
      trigger: 'website_ai',
      userId: targetUserId,
    },
    {
      cost: { total: 66 },
      createdAt: new Date('2026-08-09T08:00:00.000Z'),
      currency: 'USD',
      id: 'platform-usage-operation-other',
      model: 'claude-sonnet-4',
      provider: 'anthropic',
      status: 'done',
      totalCost: 66,
      totalTokens: 66_000,
      userId: otherUserId,
    },
  ]);

  await db.insert(travelGenerationTasks).values([
    {
      artifacts: [{ url: 'GENERATION_ARTIFACT_MUST_NOT_LEAK' }],
      createdAt: new Date('2026-08-03T08:00:00.000Z'),
      groupId: targetGroupId,
      id: 'platform-usage-generation-image',
      input: { prompt: 'GENERATION_INPUT_MUST_NOT_LEAK' },
      provider: 'seedream',
      status: 'succeeded',
      type: 'image',
      usage: {
        cost: 0.02,
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalTokens: 15,
      },
      userId: targetUserId,
    },
    {
      createdAt: new Date('2026-08-05T08:00:00.000Z'),
      groupId: targetGroupId,
      id: 'platform-usage-generation-video',
      input: { prompt: 'VIDEO_INPUT_MUST_NOT_LEAK' },
      provider: null,
      status: 'succeeded',
      type: 'video',
      usage: { cost: 0.03 },
      userId: targetUserId,
    },
    {
      createdAt: new Date('2026-08-10T08:00:00.000Z'),
      groupId: otherGroupId,
      id: 'platform-usage-generation-other',
      input: { prompt: 'OTHER_USER_INPUT_MUST_NOT_LEAK' },
      provider: 'seedream',
      status: 'succeeded',
      type: 'image',
      usage: { cost: 55, totalTokens: 55_000 },
      userId: otherUserId,
    },
  ]);
});

afterEach(cleanup);

describe('PlatformUserUsageModel', () => {
  it('requires one explicit exact target user id', async () => {
    const model = new PlatformUserUsageModel(db, ` ${targetUserId}`);

    await expect(model.getUsage()).rejects.toThrow(PLATFORM_USER_USAGE_TARGET_REQUIRED);
  });

  it('aggregates scoped canonical and operation-reported usage without double counting', async () => {
    const model = new PlatformUserUsageModel(db, targetUserId);

    const result = await model.getUsage({ recentLimit: 3 });

    expect(result.userId).toBe(targetUserId);
    expect(result.canonicalTotals).toEqual({
      costUsd: { available: true, value: 0.055 },
      totalInputTokens: { available: false, value: null },
      totalOutputTokens: { available: false, value: null },
      totalTokens: { available: false, value: null },
    });
    expect(result.operationReportedTotals).toEqual({
      costUsd: { available: true, value: 0.01 },
      totalInputTokens: { available: true, value: 1000 },
      totalOutputTokens: { available: true, value: 300 },
      totalTokens: { available: true, value: 1300 },
    });

    expect(result.byProviderModel).toEqual([
      {
        countedInCanonicalTotals: true,
        metrics: {
          costUsd: { available: true, value: 0.005 },
          totalInputTokens: { available: true, value: 300 },
          totalOutputTokens: { available: true, value: 150 },
          totalTokens: { available: true, value: 450 },
        },
        model: { available: true, value: 'gpt-5' },
        provider: { available: true, value: 'openai' },
        recordCount: 2,
        source: 'message',
      },
      {
        countedInCanonicalTotals: false,
        metrics: {
          costUsd: { available: true, value: 0.01 },
          totalInputTokens: { available: true, value: 1000 },
          totalOutputTokens: { available: true, value: 300 },
          totalTokens: { available: true, value: 1300 },
        },
        model: { available: true, value: 'claude-sonnet-4' },
        provider: { available: true, value: 'anthropic' },
        recordCount: 1,
        source: 'agent_operation',
      },
    ]);

    expect(result.byGenerationType).toEqual([
      expect.objectContaining({
        generationType: { available: true, value: 'image' },
        metrics: expect.objectContaining({
          costUsd: { available: true, value: 0.02 },
          totalTokens: { available: true, value: 15 },
        }),
        model: { available: false, value: 'unknown' },
        provider: { available: true, value: 'seedream' },
        recordCount: 1,
      }),
      expect.objectContaining({
        generationType: { available: true, value: 'video' },
        metrics: expect.objectContaining({
          costUsd: { available: true, value: 0.03 },
          totalTokens: { available: false, value: null },
        }),
        model: { available: false, value: 'unknown' },
        provider: { available: false, value: 'unknown' },
        recordCount: 1,
      }),
    ]);

    expect(result.recent.map(({ id, source }) => `${source}:${id}`)).toEqual([
      'travel_generation:platform-usage-generation-video',
      'agent_operation:platform-usage-operation-target',
      'travel_generation:platform-usage-generation-image',
    ]);
    const serialized = JSON.stringify(result);
    for (const secret of [
      'MESSAGE_BODY_MUST_NOT_LEAK',
      'MESSAGE_METADATA_MUST_NOT_LEAK',
      'OPERATION_METADATA_MUST_NOT_LEAK',
      'OPERATION_API_KEY_MUST_NOT_LEAK',
      'GENERATION_INPUT_MUST_NOT_LEAK',
      'GENERATION_ARTIFACT_MUST_NOT_LEAK',
      'OTHER_USER_INPUT_MUST_NOT_LEAK',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('reports unknown metrics instead of manufacturing zero usage', async () => {
    await db.delete(messages).where(eq(messages.userId, targetUserId));
    await db.delete(agentOperations).where(eq(agentOperations.userId, targetUserId));
    await db.delete(travelGenerationTasks).where(eq(travelGenerationTasks.userId, targetUserId));

    const result = await new PlatformUserUsageModel(db, targetUserId).getUsage();

    expect(result.canonicalTotals).toEqual({
      costUsd: { available: false, value: null },
      totalInputTokens: { available: false, value: null },
      totalOutputTokens: { available: false, value: null },
      totalTokens: { available: false, value: null },
    });
    expect(result.byProviderModel).toEqual([]);
    expect(result.byGenerationType).toEqual([]);
    expect(result.recent).toEqual([]);
  });
});
