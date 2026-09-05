// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroups,
  chatGroupsAgents,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildDefaultTravelServiceGroupRepairPlan,
  checkDefaultTravelServiceGroup,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
} from './travelServiceGroup';

const ownerId = 'travel-pipeline-owner';
const otherUserId = 'travel-pipeline-other-user';
const db: LobeChatDatabase = await getTestDB();

const getGroup = async (userId: string) => {
  const group = await db.query.chatGroups.findFirst({
    where: and(
      eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      eq(chatGroups.userId, userId),
    ),
  });
  if (!group) throw new Error('Expected group fixture');
  return group;
};

const getRoster = (groupId: string) =>
  db
    .select({
      agentId: agents.id,
      clientId: agents.clientId,
      role: chatGroupsAgents.role,
    })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(eq(chatGroupsAgents.chatGroupId, groupId));

const healthAndPlan = async (targetUserId = ownerId, workspaceId?: string) => {
  const health = await getDefaultTravelServiceGroupHealthSummary(db, {
    targetUserId,
    workspaceId,
  });
  return { health, plan: buildDefaultTravelServiceGroupRepairPlan(health) };
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([
    {
      email: 'pipeline-owner@example.test',
      emailVerified: true,
      id: ownerId,
      normalizedEmail: 'pipeline-owner@example.test',
    },
    {
      email: 'pipeline-other@example.test',
      emailVerified: true,
      id: otherUserId,
      normalizedEmail: 'pipeline-other@example.test',
    },
  ]);
});

afterEach(async () => {
  await db.delete(users);
});

describe('default travel group health-plan-execute pipeline', () => {
  it('repairs a deterministic combination of safe issues to healthy and ready', async () => {
    await initDefaultTravelServiceGroup(db, ownerId);
    const group = await getGroup(ownerId);
    const roster = await getRoster(group.id);
    const supervisor = roster.find(({ role }) => role === 'supervisor');
    const copywriter = roster.find(({ clientId }) => clientId === 'default-travel-copywriter');
    const designer = roster.find(({ clientId }) => clientId === 'default-travel-image-designer');
    const video = roster.find(({ clientId }) => clientId === 'default-travel-video-producer');
    if (!supervisor || !copywriter || !designer || !video) throw new Error('Expected full roster');
    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    await db
      .update(agents)
      .set({
        agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'member' },
        title: 'wrong supervisor title',
      })
      .where(eq(agents.id, supervisor.agentId));
    await db
      .update(chatGroupsAgents)
      .set({ enabled: false })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, copywriter.agentId),
        ),
      );
    await db.delete(agents).where(eq(agents.id, designer.agentId));
    await db
      .update(agents)
      .set({ agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'fixed' } })
      .where(eq(agents.id, video.agentId));

    const first = await healthAndPlan();
    const second = await healthAndPlan();
    expect(second.plan).toEqual(first.plan);
    expect(first.plan.actions).toEqual([
      { code: 'SET_PRIVATE', reviewRequired: false, target: 'group' },
      { code: 'RENAME_SUPERVISOR', reviewRequired: false, target: 'supervisor' },
      { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'supervisor' },
      { code: 'ENABLE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' },
      { code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'designer' },
      { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'video-producer' },
    ]);
    expect(new Set(first.plan.actions.map(({ code, target }) => `${code}:${target}`)).size).toBe(
      first.plan.actions.length,
    );

    const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: first.plan,
      targetUserId: ownerId,
    });

    expect(result.finalHealth).toMatchObject({ healthy: true, issueCodes: [] });
    await expect(checkDefaultTravelServiceGroup(db, ownerId)).resolves.toMatchObject({
      ready: true,
    });
  });

  it('marks a foreign-owner member as scope review before the executor', async () => {
    await initDefaultTravelServiceGroup(db, ownerId);
    await initDefaultTravelServiceGroup(db, otherUserId);
    const ownerGroup = await getGroup(ownerId);
    const ownerCopywriter = (await getRoster(ownerGroup.id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    const foreignCopywriter = (await getRoster((await getGroup(otherUserId)).id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    if (!ownerCopywriter || !foreignCopywriter) throw new Error('Expected copywriters');
    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, ownerGroup.id),
          eq(chatGroupsAgents.agentId, ownerCopywriter.agentId),
        ),
      );
    await db.insert(chatGroupsAgents).values({
      agentId: foreignCopywriter.agentId,
      chatGroupId: ownerGroup.id,
      enabled: true,
      role: 'participant',
      userId: ownerId,
    });

    const { health, plan } = await healthAndPlan();

    expect(health.issueCodes).toContain('DEFAULT_GROUP_SCOPE_INVALID');
    expect(plan).toMatchObject({
      actions: [{ code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', reviewRequired: true, target: 'group' }],
      reviewRequired: true,
    });
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan: plan, targetUserId: ownerId }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
  });

  it('marks duplicate specialist identity relations as review-required in stable order', async () => {
    await initDefaultTravelServiceGroup(db, ownerId);
    await initDefaultTravelServiceGroup(db, otherUserId);
    const ownerGroup = await getGroup(ownerId);
    const foreignCopywriter = (await getRoster((await getGroup(otherUserId)).id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    if (!foreignCopywriter) throw new Error('Expected copywriter');
    await db.insert(chatGroupsAgents).values({
      agentId: foreignCopywriter.agentId,
      chatGroupId: ownerGroup.id,
      enabled: true,
      role: 'participant',
      userId: ownerId,
    });

    const first = await healthAndPlan();
    const second = await healthAndPlan();

    expect(first.health.issueCodes).toEqual([
      'DEFAULT_GROUP_SCOPE_INVALID',
      'COPYWRITER_DUPLICATED',
    ]);
    expect(first.plan).toEqual(second.plan);
    expect(first.plan).toEqual({
      actions: [
        { code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED', reviewRequired: true, target: 'group' },
        {
          code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
          reviewRequired: true,
          target: 'copywriter',
        },
      ],
      reviewRequired: true,
    });
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: first.plan,
        targetUserId: ownerId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
  });

  it('marks an existing default group in another workspace as scope review, not executable create', async () => {
    await initDefaultTravelServiceGroup(db, ownerId);
    await db.insert(workspaces).values({
      id: 'pipeline-workspace',
      name: 'Pipeline workspace',
      primaryOwnerId: ownerId,
      slug: 'pipeline-workspace',
    });

    const { health, plan } = await healthAndPlan(ownerId, 'pipeline-workspace');

    expect(health.issueCodes).toEqual(['DEFAULT_GROUP_MISSING', 'DEFAULT_GROUP_SCOPE_INVALID']);
    expect(plan.reviewRequired).toBe(true);
    expect(plan.actions).toContainEqual({
      code: 'UNKNOWN_ISSUE_REVIEW_REQUIRED',
      reviewRequired: true,
      target: 'group',
    });
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: plan,
        targetUserId: ownerId,
        workspaceId: 'pipeline-workspace',
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
  });

  it('marks orphan managed identities in another workspace scope as review-required', async () => {
    await initDefaultTravelServiceGroup(db, ownerId);
    await db.delete(chatGroups).where(eq(chatGroups.userId, ownerId));
    await db.insert(workspaces).values({
      id: 'pipeline-orphan-workspace',
      name: 'Pipeline orphan workspace',
      primaryOwnerId: ownerId,
      slug: 'pipeline-orphan-workspace',
    });

    const { health, plan } = await healthAndPlan(ownerId, 'pipeline-orphan-workspace');

    expect(health.issueCodes).toEqual(['DEFAULT_GROUP_MISSING', 'DEFAULT_GROUP_SCOPE_INVALID']);
    expect(plan.reviewRequired).toBe(true);
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: plan,
        targetUserId: ownerId,
        workspaceId: 'pipeline-orphan-workspace',
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
  });

  it('keeps multiple supervisors in the manual-review branch', async () => {
    await initDefaultTravelServiceGroup(db, ownerId);
    const group = await getGroup(ownerId);
    const copywriter = (await getRoster(group.id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    if (!copywriter) throw new Error('Expected copywriter');
    await db
      .update(chatGroupsAgents)
      .set({ role: 'supervisor' })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, copywriter.agentId),
        ),
      );

    const { health, plan } = await healthAndPlan();

    expect(health.supervisor.count).toBe(2);
    expect(plan.actions[0]).toEqual({
      code: 'SUPERVISOR_REVIEW_REQUIRED',
      reviewRequired: true,
      target: 'supervisor',
    });
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan: plan, targetUserId: ownerId }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
  });
});
