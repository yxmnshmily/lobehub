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
  DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
} from './travelServiceGroup';

const userId = 'travel-supervisor-brand-user';
const db: LobeChatDatabase = await getTestDB();

const getGroup = async () => {
  const group = await db.query.chatGroups.findFirst({
    where: and(
      eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      eq(chatGroups.userId, userId),
    ),
  });
  if (!group) throw new Error('Expected group');
  return group;
};

const getSupervisor = async () => {
  const group = await getGroup();
  const [supervisor] = await db
    .select({
      agencyConfig: agents.agencyConfig,
      enabled: chatGroupsAgents.enabled,
      id: agents.id,
      slug: agents.slug,
      title: agents.title,
    })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(
      and(eq(chatGroupsAgents.chatGroupId, group.id), eq(chatGroupsAgents.role, 'supervisor')),
    );
  if (!supervisor) throw new Error('Expected supervisor');
  return { group, supervisor };
};

const healthAndPlan = async () => {
  const health = await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId: userId });
  return { health, plan: buildDefaultTravelServiceGroupRepairPlan(health) };
};

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({
    email: 'supervisor-brand@example.test',
    emailVerified: true,
    id: userId,
    normalizedEmail: 'supervisor-brand@example.test',
  });
});

afterEach(async () => {
  await db.delete(users);
});

describe('default travel supervisor brand identity', () => {
  it('creates one private platform-managed group supervisor titled 旅游群主AI', async () => {
    await initDefaultTravelServiceGroup(db, userId);

    const { group, supervisor } = await getSupervisor();

    expect(group.visibility).toBe('private');
    expect(supervisor).toMatchObject({
      agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
      enabled: true,
      slug: 'group-supervisor',
      title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
    });
  });

  it.each(['Lobe AI', 'LobeAI', '默认群主', ''])(
    'maps the historical title %j to one safe idempotent rename',
    async (historicalTitle) => {
      await initDefaultTravelServiceGroup(db, userId);
      const { supervisor } = await getSupervisor();
      await db.update(agents).set({ title: historicalTitle }).where(eq(agents.id, supervisor.id));

      const { health, plan } = await healthAndPlan();

      expect(health.issueCodes).toEqual(['SUPERVISOR_TITLE_INVALID']);
      expect(plan).toEqual({
        actions: [{ code: 'RENAME_SUPERVISOR', reviewRequired: false, target: 'supervisor' }],
        reviewRequired: false,
      });
      await executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: plan,
        targetUserId: userId,
      });
      await expect(healthAndPlan()).resolves.toMatchObject({
        health: { healthy: true, supervisor: { titleMatches: true } },
        plan: { actions: [], reviewRequired: false },
      });
    },
  );

  it('ignores a user-created ordinary assistant with the same display title', async () => {
    await initDefaultTravelServiceGroup(db, userId);
    await db.insert(agents).values({
      clientId: 'user-created-same-title-assistant',
      title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
      userId,
    });

    await expect(healthAndPlan()).resolves.toMatchObject({
      health: { healthy: true },
      plan: { actions: [], reviewRequired: false },
    });
  });

  it('rejects a same-name platform-managed impostor in the supervisor relationship', async () => {
    await initDefaultTravelServiceGroup(db, userId);
    const { group, supervisor } = await getSupervisor();
    const [impostor] = await db
      .insert(agents)
      .values({
        agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
        clientId: 'same-name-supervisor-impostor',
        title: DEFAULT_TRAVEL_GROUP_SUPERVISOR_TITLE,
        userId,
        virtual: true,
      })
      .returning({ id: agents.id });
    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, supervisor.id),
        ),
      );
    await db.insert(chatGroupsAgents).values({
      agentId: impostor.id,
      chatGroupId: group.id,
      enabled: true,
      role: 'supervisor',
      userId,
    });

    const { health, plan } = await healthAndPlan();

    expect(health.issueCodes).toEqual(['SUPERVISOR_IDENTITY_INVALID']);
    expect(plan).toEqual({
      actions: [{ code: 'SUPERVISOR_REVIEW_REQUIRED', reviewRequired: true, target: 'supervisor' }],
      reviewRequired: true,
    });
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan: plan, targetUserId: userId }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
  });

  it('repairs a disabled exact platform supervisor without adding another supervisor', async () => {
    await initDefaultTravelServiceGroup(db, userId);
    const { group, supervisor } = await getSupervisor();
    await db
      .update(chatGroupsAgents)
      .set({ enabled: false })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, supervisor.id),
        ),
      );

    const { health, plan } = await healthAndPlan();

    expect(health.issueCodes).toEqual(['SUPERVISOR_DISABLED']);
    expect(plan.actions).toEqual([
      { code: 'ENSURE_SUPERVISOR', reviewRequired: false, target: 'supervisor' },
    ]);
    await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: plan,
      targetUserId: userId,
    });
    const repaired = await getSupervisor();
    expect(repaired.supervisor.enabled).toBe(true);
    await expect(
      db
        .select({ id: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .where(
          and(eq(chatGroupsAgents.chatGroupId, group.id), eq(chatGroupsAgents.role, 'supervisor')),
        ),
    ).resolves.toHaveLength(1);
  });

  it.each(['delete', 'remove'] as const)(
    'repairs an exact platform supervisor after users %s it',
    async (operation) => {
      await initDefaultTravelServiceGroup(db, userId);
      const { group, supervisor } = await getSupervisor();
      if (operation === 'delete') {
        await db.delete(agents).where(eq(agents.id, supervisor.id));
      } else {
        await db
          .delete(chatGroupsAgents)
          .where(
            and(
              eq(chatGroupsAgents.chatGroupId, group.id),
              eq(chatGroupsAgents.agentId, supervisor.id),
            ),
          );
      }

      const { plan } = await healthAndPlan();
      expect(plan.actions).toEqual([
        { code: 'ENSURE_SUPERVISOR', reviewRequired: false, target: 'supervisor' },
      ]);
      await executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: plan,
        targetUserId: userId,
      });
      await expect(healthAndPlan()).resolves.toMatchObject({ health: { healthy: true } });
    },
  );

  it('marks a platform supervisor moved to another workspace as scope review', async () => {
    await initDefaultTravelServiceGroup(db, userId);
    const { supervisor } = await getSupervisor();
    await db.insert(workspaces).values({
      id: 'supervisor-brand-workspace',
      name: 'Supervisor brand workspace',
      primaryOwnerId: userId,
      slug: 'supervisor-brand-workspace',
    });
    await db
      .update(agents)
      .set({ workspaceId: 'supervisor-brand-workspace' })
      .where(eq(agents.id, supervisor.id));

    const { health, plan } = await healthAndPlan();

    expect(health.issueCodes).toContain('DEFAULT_GROUP_SCOPE_INVALID');
    expect(plan.reviewRequired).toBe(true);
  });
});
