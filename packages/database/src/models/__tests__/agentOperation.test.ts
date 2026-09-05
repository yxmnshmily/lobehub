// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchesAgentInterventionContinuationProvenance } from '@/business/server/agent-run/agentInterventionIdentity';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  chatGroups,
  chatGroupUserMemberships,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-test-user-id';
const otherUserId = 'agent-operation-test-other-user';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(agentOperations);
  await serverDB.delete(users);
});

describe('AgentOperationModel', () => {
  describe('getWebsiteAiActivitySnapshot', () => {
    it('counts only the customer group supervisor and keeps active and recent windows separate', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const recentSince = new Date('2026-09-02T10:00:00.000Z');
      await serverDB.insert(agents).values([
        { id: 'website-supervisor', userId },
        { id: 'website-specialist', userId },
        { id: 'other-supervisor', userId: otherUserId },
      ]);
      await serverDB.insert(chatGroups).values([
        { id: 'website-group', title: 'Website group', userId },
        { id: 'other-group', title: 'Other group', userId: otherUserId },
      ]);
      await serverDB.insert(agentOperations).values([
        {
          agentId: 'website-supervisor',
          chatGroupId: 'website-group',
          createdAt: new Date('2026-09-02T10:00:10.000Z'),
          id: 'website-running-recent',
          status: 'running',
          trigger: 'website_ai_admission',
          userId,
        },
        {
          agentId: 'website-supervisor',
          chatGroupId: 'website-group',
          createdAt: new Date('2026-09-02T10:00:20.000Z'),
          id: 'website-done-recent',
          status: 'done',
          trigger: 'website_ai_admission',
          userId,
        },
        {
          agentId: 'website-supervisor',
          chatGroupId: 'website-group',
          createdAt: new Date('2026-09-02T09:50:00.000Z'),
          id: 'website-running-old',
          status: 'waiting_for_async_tool',
          userId,
        },
        {
          agentId: 'website-specialist',
          chatGroupId: 'website-group',
          createdAt: new Date('2026-09-02T10:00:30.000Z'),
          id: 'website-child-specialist',
          status: 'running',
          userId,
        },
        {
          agentId: 'other-supervisor',
          chatGroupId: 'other-group',
          createdAt: new Date('2026-09-02T10:00:30.000Z'),
          id: 'other-user-operation',
          status: 'running',
          userId: otherUserId,
        },
      ]);

      await expect(
        model.getWebsiteAiActivitySnapshot({
          agentId: 'website-supervisor',
          chatGroupId: 'website-group',
          recentSince,
        }),
      ).resolves.toEqual({ activeCount: 2, recentCount: 2 });
    });

    it('serializes concurrent reservations on the user row across model instances', async () => {
      await serverDB.insert(agents).values({ id: 'website-supervisor-reserve', userId });
      await serverDB
        .insert(chatGroups)
        .values({ id: 'website-group-reserve', title: 'Website group', userId });
      const reserve = (reservationId: string) =>
        new AgentOperationModel(serverDB, userId).reserveWebsiteAiAdmission({
          activeLimit: 1,
          agentId: 'website-supervisor-reserve',
          chatGroupId: 'website-group-reserve',
          recentLimit: 10,
          recentSince: new Date(Date.now() - 60_000),
          reservationId,
        });

      const results = await Promise.all([reserve('admission-a'), reserve('admission-b')]);

      expect(results.sort()).toEqual(['active_limit', 'reserved']);
      const rows = await serverDB
        .select({ id: agentOperations.id })
        .from(agentOperations)
        .where(eq(agentOperations.trigger, 'website_ai_admission'));
      expect(rows).toHaveLength(1);
    });
  });

  describe('recordStart', () => {
    it('inserts a row with status=running and the provided ids', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-start-1';

      await model.recordStart({
        appContext: { scope: 'chat', sourceMessageId: 'msg-1' },
        maxSteps: 20,
        model: 'gpt-4o',
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        provider: 'openai',
        trigger: 'chat',
      });

      const row = await model.findById(operationId);
      expect(row).toMatchObject({
        appContext: { scope: 'chat', sourceMessageId: 'msg-1' },
        id: operationId,
        maxSteps: 20,
        model: 'gpt-4o',
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        provider: 'openai',
        status: 'running',
        trigger: 'chat',
        userId,
      });
      expect(row?.startedAt).toBeInstanceOf(Date);
      expect(row?.completedAt).toBeNull();
    });

    it('persists the agent-signal marker into metadata so server tools can read it back', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-start-marker';
      // Server-side self-iteration tools resolve the review window / source id from
      // metadata.agentSignal (the trimmed appContext intentionally drops it). If
      // the marker is not persisted here, tools fall back to a 1970 window +
      // operationId source.
      const agentSignal = {
        agentId: 'agent_reviewed',
        kind: 'nightly-review',
        localDate: '2026-05-30',
        reviewWindowEnd: '2026-05-30T00:00:00.000Z',
        reviewWindowStart: '2026-05-29T00:00:00.000Z',
        sourceId: 'nightly-review:user:agent_reviewed:2026-05-30',
      };

      await model.recordStart({
        appContext: { scope: 'chat' },
        metadata: { agentSignal },
        operationId,
      });

      const row = await model.findById(operationId);
      expect(row?.metadata).toEqual({ agentSignal });
    });

    it('is idempotent on the primary key', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-start-2';

      await model.recordStart({ operationId });
      // Second call must not throw — primary-key conflict is swallowed.
      await model.recordStart({ operationId });

      const rows = await serverDB
        .select()
        .from(agentOperations)
        .where(eq(agentOperations.id, operationId));
      expect(rows).toHaveLength(1);
    });
  });

  describe('hosted sponsored budget locator', () => {
    const groupId = 'hosted-budget-group';
    const operationId = 'hosted-budget-operation';
    const locator = {
      actorUserId: otherUserId,
      budgetId: 'sponsored-budget-id',
      budgetLeaseVersion: 3,
      expiresAt: '2099-09-04T00:00:00.000Z',
      groupId,
      membershipVersion: 7,
      operationId,
      payerUserId: userId,
      policyVersion: 11,
      resourceOwnerUserId: userId,
      version: 1 as const,
    };

    it('persists the exact locator once without replacing other operation metadata', async () => {
      await serverDB.insert(chatGroups).values({ id: groupId, title: 'Hosted group', userId });
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({
        chatGroupId: groupId,
        metadata: {
          hostedGroupRun: {
            actorUserIdSnapshot: otherUserId,
            expiresAt: locator.expiresAt,
            groupId,
            handleHash: 'a'.repeat(64),
            membershipVersion: locator.membershipVersion,
            ownerUserIdSnapshot: userId,
            version: 1,
          },
          preserved: true,
        },
        operationId,
      });

      await expect(model.recordHostedGroupSponsoredBudgetLocator(locator)).resolves.toBe(true);
      await expect(model.recordHostedGroupSponsoredBudgetLocator(locator)).resolves.toBe(true);

      expect((await model.findById(operationId))?.metadata).toEqual({
        hostedGroupRun: {
          actorUserIdSnapshot: otherUserId,
          expiresAt: locator.expiresAt,
          groupId,
          handleHash: 'a'.repeat(64),
          membershipVersion: locator.membershipVersion,
          ownerUserIdSnapshot: userId,
          version: 1,
        },
        hostedGroupSponsoredBudgetLocator: locator,
        preserved: true,
      });
      await expect(model.findHostedGroupSponsoredBudgetLocator(operationId)).resolves.toEqual(
        locator,
      );
    });

    it('fails closed for a conflicting locator, owner mismatch, or hosted-run mismatch', async () => {
      await serverDB.insert(chatGroups).values({ id: groupId, title: 'Hosted group', userId });
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({
        chatGroupId: groupId,
        metadata: {
          hostedGroupRun: {
            actorUserIdSnapshot: otherUserId,
            expiresAt: locator.expiresAt,
            groupId,
            handleHash: 'b'.repeat(64),
            membershipVersion: locator.membershipVersion,
            ownerUserIdSnapshot: userId,
            version: 1,
          },
        },
        operationId,
      });
      await expect(model.recordHostedGroupSponsoredBudgetLocator(locator)).resolves.toBe(true);

      await expect(
        model.recordHostedGroupSponsoredBudgetLocator({ ...locator, budgetId: 'other-budget' }),
      ).resolves.toBe(false);
      await expect(
        new AgentOperationModel(serverDB, otherUserId).recordHostedGroupSponsoredBudgetLocator({
          ...locator,
          payerUserId: otherUserId,
          resourceOwnerUserId: otherUserId,
        }),
      ).resolves.toBe(false);

      const mismatchedOperationId = 'hosted-budget-run-mismatch';
      await model.recordStart({
        chatGroupId: groupId,
        metadata: {
          hostedGroupRun: {
            actorUserIdSnapshot: 'another-actor',
            expiresAt: locator.expiresAt,
            groupId,
            handleHash: 'c'.repeat(64),
            membershipVersion: locator.membershipVersion,
            ownerUserIdSnapshot: userId,
            version: 1,
          },
        },
        operationId: mismatchedOperationId,
      });
      await expect(
        model.recordHostedGroupSponsoredBudgetLocator({
          ...locator,
          operationId: mismatchedOperationId,
        }),
      ).resolves.toBe(false);

      expect(
        (await model.findById(operationId))?.metadata,
      ).toHaveProperty('hostedGroupSponsoredBudgetLocator.budgetId', locator.budgetId);
    });

    it('does not return a locator after the operation becomes terminal', async () => {
      await serverDB.insert(chatGroups).values({ id: groupId, title: 'Hosted group', userId });
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({
        chatGroupId: groupId,
        metadata: {
          hostedGroupRun: {
            actorUserIdSnapshot: otherUserId,
            expiresAt: locator.expiresAt,
            groupId,
            handleHash: 'd'.repeat(64),
            membershipVersion: locator.membershipVersion,
            ownerUserIdSnapshot: userId,
            version: 1,
          },
        },
        operationId,
      });
      await expect(model.recordHostedGroupSponsoredBudgetLocator(locator)).resolves.toBe(true);
      await expect(model.settleRunning(operationId, 'done')).resolves.toBe(true);

      await expect(model.findHostedGroupSponsoredBudgetLocator(operationId)).resolves.toBeNull();
    });
  });

  describe('agent intervention dispatch recovery markers', () => {
    it('persists ready preparation and queue ACK without replacing provenance', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-intervention-marker';
      const provenance = {
        resolutionRequestId: 'request-intervention-marker',
        sourceOperationId: 'source-operation',
        sourceToolMessageIds: ['tool-message'],
      };
      await model.recordStart({
        metadata: { agentInterventionContinuation: provenance },
        operationId,
      });

      await expect(
        model.recordAgentInterventionPreparation(operationId, {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          resolutionRequestId: provenance.resolutionRequestId,
          state: 'ready',
          stepIndex: 0,
        }),
      ).resolves.toBe(true);
      await expect(
        model.recordAgentInterventionDispatch(operationId, {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          messageId: 'queue-message',
          resolutionRequestId: provenance.resolutionRequestId,
          scheduledAt: '2026-08-26T00:00:00.000Z',
          state: 'scheduled',
        }),
      ).resolves.toBe(true);

      const row = await model.findById(operationId);
      expect(
        matchesAgentInterventionContinuationProvenance(
          row?.metadata?.agentInterventionContinuation,
          provenance,
        ),
      ).toBe(true);
      expect(row?.metadata).toMatchObject({
        agentInterventionContinuation: provenance,
        agentInterventionDispatch: {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          state: 'scheduled',
        },
        agentInterventionPreparation: {
          deduplicationId: 'agent-intervention:op-intervention-marker:0',
          state: 'ready',
          stepIndex: 0,
        },
      });
    });

    it('rejects a preparation marker from another request or owner', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const attacker = new AgentOperationModel(serverDB, otherUserId);
      const operationId = 'op-intervention-marker-authority';
      await model.recordStart({
        metadata: {
          agentInterventionContinuation: {
            resolutionRequestId: 'request-owner',
            sourceOperationId: 'source-operation',
            sourceToolMessageIds: ['tool-message'],
          },
        },
        operationId,
      });
      const marker = {
        deduplicationId: 'agent-intervention:op-intervention-marker-authority:0',
        resolutionRequestId: 'request-other',
        state: 'ready' as const,
        stepIndex: 0,
      };

      await expect(model.recordAgentInterventionPreparation(operationId, marker)).resolves.toBe(
        false,
      );
      await expect(
        attacker.recordAgentInterventionPreparation(operationId, {
          ...marker,
          resolutionRequestId: 'request-owner',
        }),
      ).resolves.toBe(false);
      expect((await model.findById(operationId))?.metadata).not.toHaveProperty(
        'agentInterventionPreparation',
      );
    });
  });

  describe('recordCompletion', () => {
    it('atomically stores a server-validated hosted member final marker', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-hosted-member-final';
      const hostedGroupRun = {
        actorUserIdSnapshot: otherUserId,
        expiresAt: '2099-09-04T00:00:00.000Z',
        groupId: 'private-travel-group',
        handleHash: 'a'.repeat(64),
        membershipVersion: 2,
        ownerUserIdSnapshot: userId,
        version: 1,
      };

      await serverDB.insert(chatGroups).values({
        id: hostedGroupRun.groupId,
        title: 'Private travel group',
        userId,
      });
      await serverDB.insert(chatGroupUserMemberships).values({
        chatGroupId: hostedGroupRun.groupId,
        invitedByUserId: userId,
        membershipVersion: hostedGroupRun.membershipVersion,
        userId: otherUserId,
      });
      await model.recordStart({
        chatGroupId: hostedGroupRun.groupId,
        metadata: { hostedGroupRun },
        operationId,
      });
      const finalMarker = {
        actorUserIdSnapshot: otherUserId,
        assistantMessageId: 'message-final',
        contentHash: 'a'.repeat(64),
        groupId: 'private-travel-group',
        membershipVersion: 2,
        operationId,
        ownerUserIdSnapshot: userId,
        publishedAt: '2026-09-04T00:00:00.000Z',
        version: 1 as const,
      };
      await expect(
        model.recordCompletion(operationId, {
          completionReason: 'done',
          hostedGroupMemberFinal: { ...finalMarker, contentHash: 'A'.repeat(64) },
          status: 'done',
        }),
      ).resolves.toBe(false);
      expect((await model.findById(operationId))?.status).toBe('running');

      await expect(
        model.recordCompletion(operationId, {
          completedAt: new Date(),
          completionReason: 'done',
          hostedGroupMemberFinal: finalMarker,
          status: 'done',
        }),
      ).resolves.toBe(true);

      expect((await model.findById(operationId))?.metadata).toMatchObject({
        hostedGroupMemberFinal: { assistantMessageId: 'message-final', operationId },
        hostedGroupRun,
      });
    });

    it('rejects a hosted final marker when the durable start has no matching hosted run', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-forged-hosted-final';
      await model.recordStart({ operationId });

      await expect(
        model.recordCompletion(operationId, {
          completionReason: 'done',
          hostedGroupMemberFinal: {
            actorUserIdSnapshot: otherUserId,
            assistantMessageId: 'message-forged',
            contentHash: 'a'.repeat(64),
            groupId: 'private-travel-group',
            membershipVersion: 2,
            operationId,
            ownerUserIdSnapshot: userId,
            publishedAt: '2026-09-04T00:00:00.000Z',
            version: 1,
          },
          status: 'done',
        }),
      ).resolves.toBe(true);
      expect((await model.findById(operationId))?.status).toBe('done');
      expect((await model.findById(operationId))?.metadata).not.toHaveProperty(
        'hostedGroupMemberFinal',
      );
    });

    it('updates the row to a terminal status with aggregates and trace key', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-complete-1';

      const completedAt = new Date('2026-05-13T01:23:45.000Z');
      await model.recordStart({ operationId });
      await model.recordCompletion(operationId, {
        completedAt,
        completionReason: 'done',
        cost: { total: 0.123 },
        llmCalls: 4,
        processingTimeMs: 5432,
        status: 'done',
        stepCount: 7,
        toolCalls: 2,
        totalCost: 0.123,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalTokens: 1200,
        traceS3Key: 'agent-traces/agent-x/topic-x/op-complete-1.json',
        usage: { llm: { apiCalls: 4 } },
      });

      const row = await model.findById(operationId);
      expect(row).toMatchObject({
        completionReason: 'done',
        cost: { total: 0.123 },
        llmCalls: 4,
        processingTimeMs: 5432,
        status: 'done',
        stepCount: 7,
        toolCalls: 2,
        totalCost: 0.123,
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        totalTokens: 1200,
        traceS3Key: 'agent-traces/agent-x/topic-x/op-complete-1.json',
      });
      expect(row?.completedAt?.toISOString()).toBe(completedAt.toISOString());
    });

    it('leaves completedAt null when not explicitly provided (e.g. waiting_for_human)', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-waiting';

      await model.recordStart({ operationId });
      await model.recordCompletion(operationId, {
        completionReason: 'waiting_for_human',
        status: 'waiting_for_human',
      });

      const row = await model.findById(operationId);
      expect(row?.status).toBe('waiting_for_human');
      expect(row?.completedAt).toBeNull();
    });

    it('writes error and interruption payloads on failure paths', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-complete-error';

      await model.recordStart({ operationId });
      await model.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'error',
        error: { message: 'boom', type: 'AgentRuntimeError' },
        interruption: {
          canResume: false,
          interruptedAt: '2026-05-13T00:00:00.000Z',
          reason: 'rate_limited',
        },
        status: 'error',
      });

      const row = await model.findById(operationId);
      expect(row?.status).toBe('error');
      expect(row?.completionReason).toBe('error');
      expect(row?.error).toMatchObject({ message: 'boom', type: 'AgentRuntimeError' });
      expect(row?.interruption).toMatchObject({ canResume: false, reason: 'rate_limited' });
    });

    it('is a no-op when the start row was never written', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      // No prior recordStart — recordCompletion must not throw and must not
      // create a phantom row.
      await model.recordCompletion('op-missing', { status: 'done', completionReason: 'done' });

      const row = await model.findById('op-missing');
      expect(row).toBeNull();
    });

    it('does not flip another user’s row when their operationId is known', async () => {
      const ownerModel = new AgentOperationModel(serverDB, userId);
      const attackerModel = new AgentOperationModel(serverDB, otherUserId);
      const operationId = 'op-cross-user';

      await ownerModel.recordStart({ operationId });
      await attackerModel.recordCompletion(operationId, {
        completedAt: new Date(),
        completionReason: 'error',
        error: { message: 'spoofed', type: 'AgentRuntimeError' },
        status: 'error',
      });

      // Owner's row must still read as running — the cross-user update is
      // filtered out by the userId scope in the WHERE clause.
      const row = await ownerModel.findById(operationId);
      expect(row?.status).toBe('running');
      expect(row?.error).toBeNull();
      // The attacker cannot read the row either.
      expect(await attackerModel.findById(operationId)).toBeNull();
    });
  });

  describe('operation lease', () => {
    it('refreshes a running operation and only settles an expired lease', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-lease';
      await model.recordStart({ operationId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));

      await model.touchRunning(operationId);
      const refreshed = await model.findById(operationId);
      expect(refreshed!.updatedAt.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00.000Z').getTime(),
      );

      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(
        false,
      );
      expect((await model.findById(operationId))?.status).toBe('running');

      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));
      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(true);
      expect(await model.findById(operationId)).toMatchObject({
        completionReason: 'lease_expired',
        status: 'abandoned',
      });
    });

    it('persists the latest cost while reclaiming an expired lease', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-lease-cost';
      await model.recordStart({ operationId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));

      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000), 0.75)).toBe(
        true,
      );
      expect(await model.findById(operationId)).toMatchObject({
        status: 'abandoned',
        totalCost: 0.75,
      });
    });

    it('does not let a late completion overwrite a reclaimed operation', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const operationId = 'op-reclaimed-completion-race';
      await model.recordStart({ operationId });
      await serverDB
        .update(agentOperations)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(agentOperations.id, operationId));

      expect(await model.settleStaleRunning(operationId, new Date(Date.now() - 60_000))).toBe(true);
      expect(
        await model.recordCompletion(operationId, {
          completionReason: 'done',
          status: 'done',
        }),
      ).toBe(false);
      expect(await model.findById(operationId)).toMatchObject({
        completionReason: 'lease_expired',
        status: 'abandoned',
      });
    });
  });

  describe('sumChildUsage', () => {
    const seedChild = async (
      model: AgentOperationModel,
      id: string,
      parentOperationId: string,
      usage: { llmCalls: number; toolCalls: number; totalCost: number; totalTokens: number },
    ) => {
      await model.recordStart({ operationId: id, parentOperationId });
      await model.recordCompletion(id, {
        completionReason: 'done',
        llmCalls: usage.llmCalls,
        status: 'done',
        toolCalls: usage.toolCalls,
        totalCost: usage.totalCost,
        totalInputTokens: usage.totalTokens,
        totalOutputTokens: 0,
        totalTokens: usage.totalTokens,
      });
    };

    it('sums every child of the parent', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({ operationId: 'parent' });
      await seedChild(model, 'child-a', 'parent', {
        llmCalls: 2,
        toolCalls: 3,
        totalCost: 0.25,
        totalTokens: 1000,
      });
      await seedChild(model, 'child-b', 'parent', {
        llmCalls: 1,
        toolCalls: 4,
        totalCost: 0.75,
        totalTokens: 2000,
      });

      const rollup = await model.sumChildUsage('parent');

      expect(rollup).toEqual({
        llmCalls: 3,
        toolCalls: 7,
        totalCost: 1,
        totalInputTokens: 3000,
        totalOutputTokens: 0,
        totalTokens: 3000,
      });
    });

    // The whole reason this is a read-time SUM: the sub-agent completion bridge is
    // contractually re-deliverable, so an accumulation onto the parent row would
    // double-count. Re-deriving is exact however many times it runs.
    it('is idempotent — re-deriving does not accumulate', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({ operationId: 'parent' });
      await seedChild(model, 'child-a', 'parent', {
        llmCalls: 1,
        toolCalls: 1,
        totalCost: 0.5,
        totalTokens: 1234,
      });

      const first = await model.sumChildUsage('parent');
      const second = await model.sumChildUsage('parent');

      expect(second).toEqual(first);
      expect(second.totalTokens).toBe(1234);
    });

    it('returns zeroes for an operation with no children', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await model.recordStart({ operationId: 'lonely' });

      expect(await model.sumChildUsage('lonely')).toEqual({
        llmCalls: 0,
        toolCalls: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      });
    });

    it("does not sum another user's children", async () => {
      const model = new AgentOperationModel(serverDB, userId);
      const attacker = new AgentOperationModel(serverDB, otherUserId);
      await model.recordStart({ operationId: 'parent' });
      await seedChild(model, 'child-a', 'parent', {
        llmCalls: 1,
        toolCalls: 1,
        totalCost: 0.5,
        totalTokens: 1000,
      });

      expect(await attacker.sumChildUsage('parent')).toEqual({
        llmCalls: 0,
        toolCalls: 0,
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe('getMaxDurationSeconds', () => {
    it('returns the longest wall-clock duration, ignoring in-flight and other users', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values([
        // 5 minutes
        {
          completedAt: new Date('2026-05-13T10:05:00.000Z'),
          id: 'op-dur-1',
          startedAt: new Date('2026-05-13T10:00:00.000Z'),
          status: 'done',
          userId,
        },
        // 1 hour — the longest
        {
          completedAt: new Date('2026-05-13T12:00:00.000Z'),
          id: 'op-dur-2',
          startedAt: new Date('2026-05-13T11:00:00.000Z'),
          status: 'done',
          userId,
        },
        // in-flight: no completedAt -> excluded
        {
          completedAt: null,
          id: 'op-dur-running',
          startedAt: new Date('2026-05-13T09:00:00.000Z'),
          status: 'running',
          userId,
        },
        // another user's much longer op -> excluded
        {
          completedAt: new Date('2026-05-13T20:00:00.000Z'),
          id: 'op-dur-other',
          startedAt: new Date('2026-05-13T10:00:00.000Z'),
          status: 'done',
          userId: otherUserId,
        },
      ]);

      const result = await model.getMaxDurationSeconds();
      expect(result).toBe(3600);
    });

    it('returns 0 when there are no completed operations', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values({
        completedAt: null,
        id: 'op-dur-none',
        startedAt: new Date('2026-05-13T09:00:00.000Z'),
        status: 'running',
        userId,
      });

      const result = await model.getMaxDurationSeconds();
      expect(result).toBe(0);
    });
  });

  describe('listOperationTree', () => {
    it('returns the root op together with its direct children, owner-scoped', async () => {
      const model = new AgentOperationModel(serverDB, userId);

      await serverDB.insert(agentOperations).values([
        { id: 'root', status: 'done', userId },
        { id: 'child-a', parentOperationId: 'root', status: 'done', userId },
        { id: 'child-b', parentOperationId: 'root', status: 'done', userId },
        // Unrelated op (different parent) must not leak in.
        { id: 'stranger', parentOperationId: 'other-root', status: 'done', userId },
        // Another user's child of the same root must not leak in.
        { id: 'foreign-child', parentOperationId: 'root', status: 'done', userId: otherUserId },
      ]);

      const tree = await model.listOperationTree('root');
      expect(tree.map((op) => op.id).sort()).toEqual(['child-a', 'child-b', 'root']);
    });

    it('returns just the root when it has no children', async () => {
      const model = new AgentOperationModel(serverDB, userId);
      await serverDB.insert(agentOperations).values({ id: 'lonely', status: 'done', userId });

      const tree = await model.listOperationTree('lonely');
      expect(tree.map((op) => op.id)).toEqual(['lonely']);
    });
  });
});
