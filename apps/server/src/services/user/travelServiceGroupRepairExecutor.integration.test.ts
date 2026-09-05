// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  agentSkills,
  chatGroups,
  chatGroupsAgents,
  users,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildDefaultTravelServiceGroupRepairPlan,
  checkDefaultTravelServiceGroup,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  type DefaultTravelServiceGroupRepairPlan,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
  TRAVEL_SPECIALIST_TEMPLATES,
} from './travelServiceGroup';

const firstUserId = 'travel-repair-executor-user-a';
const secondUserId = 'travel-repair-executor-user-b';
const db: LobeChatDatabase = await getTestDB();

const preview = async (targetUserId: string, workspaceId?: string) =>
  buildDefaultTravelServiceGroupRepairPlan(
    await getDefaultTravelServiceGroupHealthSummary(db, { targetUserId, workspaceId }),
  );

const getDefaultGroup = async (userId: string) => {
  const group = await db.query.chatGroups.findFirst({
    where: and(
      eq(chatGroups.clientId, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
      eq(chatGroups.userId, userId),
    ),
  });
  if (!group) throw new Error('Expected default travel group');
  return group;
};

const getRoster = (groupId: string) =>
  db
    .select({
      agentId: agents.id,
      clientId: agents.clientId,
      role: chatGroupsAgents.role,
      slug: agents.slug,
    })
    .from(chatGroupsAgents)
    .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
    .where(eq(chatGroupsAgents.chatGroupId, groupId));

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values([
    {
      email: 'repair-a@example.test',
      emailVerified: true,
      id: firstUserId,
      normalizedEmail: 'repair-a@example.test',
    },
    {
      email: 'repair-b@example.test',
      emailVerified: true,
      id: secondUserId,
      normalizedEmail: 'repair-b@example.test',
    },
  ]);
});

afterEach(async () => {
  await db.execute(sql`DROP TRIGGER IF EXISTS fail_travel_member_enable ON chat_groups_agents`);
  await db.execute(sql`DROP FUNCTION IF EXISTS fail_travel_member_enable()`);
  await db.delete(users);
});

describe('executeDefaultTravelServiceGroupRepairPlan', () => {
  it('repairs only the previewed safe actions and returns a data-free result', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await getDefaultGroup(firstUserId);
    const roster = await getRoster(group.id);
    const supervisor = roster.find(({ role }) => role === 'supervisor');
    const copywriter = roster.find(({ clientId }) => clientId === 'default-travel-copywriter');
    const video = roster.find(({ clientId }) => clientId === 'default-travel-video-producer');
    if (!supervisor || !copywriter || !video) throw new Error('Expected repair fixtures');

    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    await db
      .update(agents)
      .set({ title: 'title that must not be returned' })
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
    await db
      .update(agents)
      .set({ agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'fixed' } })
      .where(eq(agents.id, video.agentId));

    const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: await preview(firstUserId),
      targetUserId: firstUserId,
    });

    expect(result).toEqual({
      actionCounts: [
        { code: 'SET_PRIVATE', count: 1 },
        { code: 'RENAME_SUPERVISOR', count: 1 },
        { code: 'ENABLE_REQUIRED_MEMBER', count: 1 },
        { code: 'MARK_PLATFORM_MANAGED', count: 1 },
      ],
      finalHealth: expect.objectContaining({ healthy: true, issueCodes: [] }),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(firstUserId);
    expect(serialized).not.toContain('title that must not be returned');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('conversation');
    expect(serialized).not.toContain('"model"');
    expect(serialized).not.toContain('systemRole');
    expect(serialized).not.toContain('provider');
    expect(serialized).not.toContain('apiKey');
  });

  it('creates one complete group and a repeated fresh healthy plan is an idempotent no-op', async () => {
    const firstResult = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: await preview(firstUserId),
      targetUserId: firstUserId,
    });
    const group = await getDefaultGroup(firstUserId);

    expect(firstResult.actionCounts).toEqual([{ code: 'CREATE_DEFAULT_GROUP', count: 1 }]);
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: await preview(firstUserId),
        targetUserId: firstUserId,
      }),
    ).resolves.toMatchObject({ actionCounts: [], finalHealth: { healthy: true } });
    await expect(getRoster(group.id)).resolves.toHaveLength(5);
    await expect(
      db.select({ id: chatGroups.id }).from(chatGroups).where(eq(chatGroups.userId, firstUserId)),
    ).resolves.toHaveLength(1);
  });

  it('repairs an old copywriter missing the controlled copy tool without replacing custom plugins', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await getDefaultGroup(firstUserId);
    const copywriter = (await getRoster(group.id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    if (!copywriter) throw new Error('Expected copywriter fixture');

    await db
      .update(agents)
      .set({ plugins: ['tourism-copywriting', 'custom-user-tool'] })
      .where(eq(agents.id, copywriter.agentId));

    const expectedPlan = await preview(firstUserId);
    expect(expectedPlan).toEqual({
      actions: [{ code: 'ENSURE_REQUIRED_MEMBER', reviewRequired: false, target: 'copywriter' }],
      reviewRequired: false,
    });

    const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan,
      targetUserId: firstUserId,
    });
    const repaired = await db.query.agents.findFirst({
      columns: { plugins: true },
      where: eq(agents.id, copywriter.agentId),
    });

    expect(result).toMatchObject({
      actionCounts: [{ code: 'ENSURE_REQUIRED_MEMBER', count: 1 }],
      finalHealth: { healthy: true, issueCodes: [] },
    });
    expect(repaired?.plugins).toEqual([
      'tourism-copywriting',
      'custom-user-tool',
      'lobe-travel-production',
    ]);
  });

  it('repairs missing skills and tools for every specialist through one action per member', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    await db.delete(agentSkills).where(eq(agentSkills.userId, firstUserId));

    for (const template of TRAVEL_SPECIALIST_TEMPLATES) {
      await db
        .update(agents)
        .set({ plugins: [`custom-${template.key}`] })
        .where(and(eq(agents.userId, firstUserId), eq(agents.clientId, template.clientId)));
    }

    const expectedPlan = await preview(firstUserId);
    expect(expectedPlan).toEqual({
      actions: TRAVEL_SPECIALIST_TEMPLATES.map(({ key }) => ({
        code: 'ENSURE_REQUIRED_MEMBER',
        reviewRequired: false,
        target: key,
      })),
      reviewRequired: false,
    });

    const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan,
      targetUserId: firstUserId,
    });

    expect(result.finalHealth).toMatchObject({ healthy: true, issueCodes: [] });
    await expect(checkDefaultTravelServiceGroup(db, firstUserId)).resolves.toMatchObject({
      missingSkillBindings: [],
      missingSkillIdentifiers: [],
      missingToolBindings: [],
      ready: true,
    });
    await expect(
      db
        .select({ id: agentSkills.id })
        .from(agentSkills)
        .where(eq(agentSkills.userId, firstUserId)),
    ).resolves.toHaveLength(TRAVEL_SPECIALIST_TEMPLATES.length);

    for (const template of TRAVEL_SPECIALIST_TEMPLATES) {
      const specialist = await db.query.agents.findFirst({
        columns: { plugins: true },
        where: and(eq(agents.userId, firstUserId), eq(agents.clientId, template.clientId)),
      });
      expect(specialist?.plugins).toEqual(
        expect.arrayContaining([
          `custom-${template.key}`,
          ...template.plugins,
          ...template.skillSlots,
        ]),
      );
    }
  });

  it('ensures a missing supervisor and a missing required membership without duplication', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await getDefaultGroup(firstUserId);
    const roster = await getRoster(group.id);
    const supervisor = roster.find(({ role }) => role === 'supervisor');
    const designer = roster.find(({ clientId }) => clientId === 'default-travel-image-designer');
    if (!supervisor || !designer) throw new Error('Expected repair fixtures');

    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, supervisor.agentId),
        ),
      );
    await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: await preview(firstUserId),
      targetUserId: firstUserId,
    });
    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, designer.agentId),
        ),
      );

    const result = await executeDefaultTravelServiceGroupRepairPlan(db, {
      expectedPlan: await preview(firstUserId),
      targetUserId: firstUserId,
    });

    expect(result.actionCounts).toEqual([{ code: 'ENSURE_REQUIRED_MEMBER', count: 1 }]);
    await expect(getRoster(group.id)).resolves.toHaveLength(5);
    await expect(preview(firstUserId)).resolves.toEqual({ actions: [], reviewRequired: false });
  });

  it('rejects review-required and unknown actions before changing data', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await getDefaultGroup(firstUserId);
    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    const reviewPlan: DefaultTravelServiceGroupRepairPlan = {
      actions: [
        {
          code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
          reviewRequired: true,
          target: 'group',
        },
      ],
      reviewRequired: true,
    };
    const unknownPlan = {
      actions: [{ code: 'FUTURE_ACTION', reviewRequired: false, target: 'group' }],
      reviewRequired: false,
    } as unknown as DefaultTravelServiceGroupRepairPlan;

    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: reviewPlan,
        targetUserId: firstUserId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: unknownPlan,
        targetUserId: firstUserId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_ACTION_NOT_ALLOWED');
    await expect(getDefaultGroup(firstUserId)).resolves.toMatchObject({ visibility: 'public' });
  });

  it('rejects a stale preview before applying any action', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await getDefaultGroup(firstUserId);
    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    const stalePlan = await preview(firstUserId);
    await db.update(chatGroups).set({ visibility: 'private' }).where(eq(chatGroups.id, group.id));

    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: stalePlan,
        targetUserId: firstUserId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_STATE_CHANGED');
    await expect(getDefaultGroup(firstUserId)).resolves.toMatchObject({ visibility: 'private' });
  });

  it('fails closed when a required member agent belongs to another user', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    await initDefaultTravelServiceGroup(db, secondUserId);
    const firstGroup = await getDefaultGroup(firstUserId);
    const firstCopywriter = (await getRoster(firstGroup.id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    const secondCopywriter = (await getRoster((await getDefaultGroup(secondUserId)).id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    if (!firstCopywriter || !secondCopywriter) throw new Error('Expected copywriters');
    await db
      .delete(chatGroupsAgents)
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, firstGroup.id),
          eq(chatGroupsAgents.agentId, firstCopywriter.agentId),
        ),
      );
    await db.insert(chatGroupsAgents).values({
      agentId: secondCopywriter.agentId,
      chatGroupId: firstGroup.id,
      enabled: false,
      role: 'participant',
      userId: firstUserId,
    });

    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: await preview(firstUserId),
        targetUserId: firstUserId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
    await expect(getDefaultGroup(firstUserId)).resolves.toMatchObject({ visibility: 'private' });
  });

  it('fails closed when the requested workspace differs from an existing group scope', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    await db.insert(workspaces).values({
      id: 'repair-other-workspace',
      name: 'Repair other workspace',
      primaryOwnerId: firstUserId,
      slug: 'repair-other-workspace',
    });

    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: await preview(firstUserId, 'repair-other-workspace'),
        targetUserId: firstUserId,
        workspaceId: 'repair-other-workspace',
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_REVIEW_REQUIRED');
    await expect(
      db.select({ id: chatGroups.id }).from(chatGroups).where(eq(chatGroups.userId, firstUserId)),
    ).resolves.toHaveLength(1);
  });

  it('rolls back an earlier safe action when a later action fails', async () => {
    await initDefaultTravelServiceGroup(db, firstUserId);
    const group = await getDefaultGroup(firstUserId);
    const copywriter = (await getRoster(group.id)).find(
      ({ clientId }) => clientId === 'default-travel-copywriter',
    );
    if (!copywriter) throw new Error('Expected copywriter');
    await db.update(chatGroups).set({ visibility: 'public' }).where(eq(chatGroups.id, group.id));
    await db
      .update(chatGroupsAgents)
      .set({ enabled: false })
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, copywriter.agentId),
        ),
      );
    await db.execute(sql`
      CREATE FUNCTION fail_travel_member_enable() RETURNS trigger AS $$
      BEGIN
        IF OLD.enabled = FALSE AND NEW.enabled = TRUE THEN
          RAISE EXCEPTION 'forced test failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER fail_travel_member_enable
      BEFORE UPDATE ON chat_groups_agents
      FOR EACH ROW EXECUTE FUNCTION fail_travel_member_enable()
    `);

    await expect(
      executeDefaultTravelServiceGroupRepairPlan(db, {
        expectedPlan: await preview(firstUserId),
        targetUserId: firstUserId,
      }),
    ).rejects.toThrow('TRAVEL_GROUP_REPAIR_EXECUTION_FAILED');
    await expect(getDefaultGroup(firstUserId)).resolves.toMatchObject({ visibility: 'public' });
    await expect(
      db.query.chatGroupsAgents.findFirst({
        where: and(
          eq(chatGroupsAgents.chatGroupId, group.id),
          eq(chatGroupsAgents.agentId, copywriter.agentId),
        ),
      }),
    ).resolves.toMatchObject({ enabled: false });
  });

  it('keeps one group and one five-member roster under concurrent execution', async () => {
    const expectedPlan = await preview(firstUserId);
    const results = await Promise.allSettled([
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan, targetUserId: firstUserId }),
      executeDefaultTravelServiceGroupRepairPlan(db, { expectedPlan, targetUserId: firstUserId }),
    ]);

    expect(results.some(({ status }) => status === 'fulfilled')).toBe(true);
    const groups = await db
      .select({ id: chatGroups.id })
      .from(chatGroups)
      .where(eq(chatGroups.userId, firstUserId));
    expect(groups).toHaveLength(1);
    await expect(getRoster(groups[0].id)).resolves.toHaveLength(5);
    await expect(preview(firstUserId)).resolves.toEqual({ actions: [], reviewRequired: false });
  });
});
