// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, chatGroupsAgents, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UserService } from './index';
import {
  backfillDefaultTravelGroupSupervisorProfile,
  checkDefaultTravelServiceGroup,
  DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT,
  initDefaultTravelServiceGroup,
} from './travelServiceGroup';

const db: LobeChatDatabase = await getTestDB();
const userId = 'supervisor-profile-user';

beforeEach(async () => {
  await db.delete(users);
  await db.insert(users).values({ emailVerified: true, id: userId });
});
afterEach(async () => {
  await db.delete(users);
});

const createGroup = async () => {
  const group = await initDefaultTravelServiceGroup(db, userId);
  if (!group) throw new Error('Group fixture missing');
  const member = await db.query.chatGroupsAgents.findFirst({
    where: and(eq(chatGroupsAgents.chatGroupId, group.id), eq(chatGroupsAgents.role, 'supervisor')),
  });
  if (!member) throw new Error('Supervisor fixture missing');
  return { group, supervisorId: member.agentId };
};

describe('existing default group supervisor profile backfill', () => {
  it('upgrades blank duties without creating members, then becomes a no-op', async () => {
    const { group, supervisorId } = await createGroup();
    await db.update(agents).set({ description: null }).where(eq(agents.id, supervisorId));
    await db.update(chatGroups).set({ content: '  ' }).where(eq(chatGroups.id, group.id));
    expect(await backfillDefaultTravelGroupSupervisorProfile(db, userId, group.id)).toBe(true);
    expect(
      (await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group.id) }))?.content,
    ).toBe(DEFAULT_TRAVEL_GROUP_SYSTEM_PROMPT);
    expect(await backfillDefaultTravelGroupSupervisorProfile(db, userId, group.id)).toBe(false);
    expect(
      await db.query.chatGroupsAgents.findMany({
        where: eq(chatGroupsAgents.chatGroupId, group.id),
      }),
    ).toHaveLength(5);
  });

  it('does not backfill another user group or an ordinary group', async () => {
    const { group, supervisorId } = await createGroup();
    await db.insert(users).values({ id: 'other-profile-user', emailVerified: true });
    await db.update(agents).set({ description: null }).where(eq(agents.id, supervisorId));
    expect(
      await backfillDefaultTravelGroupSupervisorProfile(db, 'other-profile-user', group.id),
    ).toBe(false);
    await db
      .update(chatGroups)
      .set({ clientId: 'ordinary-group' })
      .where(eq(chatGroups.id, group.id));
    expect(await backfillDefaultTravelGroupSupervisorProfile(db, userId, group.id)).toBe(false);
    expect(
      (await db.query.agents.findFirst({ where: eq(agents.id, supervisorId) }))?.description,
    ).toBeNull();
  });

  it('fills the blank introduction even when readiness is already satisfied', async () => {
    const { group, supervisorId } = await createGroup();
    await db.update(agents).set({ description: '  ' }).where(eq(agents.id, supervisorId));
    await db
      .update(chatGroups)
      .set({ content: 'Keep my custom coordination instructions.' })
      .where(eq(chatGroups.id, group.id));
    expect((await checkDefaultTravelServiceGroup(db, userId)).ready).toBe(true);

    await new UserService(db).ensureTravelServiceReady(userId);

    const supervisor = await db.query.agents.findFirst({ where: eq(agents.id, supervisorId) });
    expect(supervisor?.description).toBe(
      '负责超级工作群的协作架构、任务分工与讨论秩序，协调分歧，避免争吵，并汇总群内助理的工作成果。',
    );
    expect(
      (await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group.id) }))?.content,
    ).toBe('Keep my custom coordination instructions.');
    expect(
      await db.query.chatGroupsAgents.findMany({
        where: eq(chatGroupsAgents.chatGroupId, group.id),
      }),
    ).toHaveLength(5);
  });

  it('preserves a nonempty custom introduction and instructions across repeated readiness', async () => {
    const { group, supervisorId } = await createGroup();
    await db
      .update(agents)
      .set({ description: 'My custom introduction' })
      .where(eq(agents.id, supervisorId));
    await db
      .update(chatGroups)
      .set({ content: 'My custom rules' })
      .where(eq(chatGroups.id, group.id));
    await new UserService(db).ensureTravelServiceReady(userId);
    await new UserService(db).ensureTravelServiceReady(userId);
    expect(
      (await db.query.agents.findFirst({ where: eq(agents.id, supervisorId) }))?.description,
    ).toBe('My custom introduction');
    expect(
      (await db.query.chatGroups.findFirst({ where: eq(chatGroups.id, group.id) }))?.content,
    ).toBe('My custom rules');
  });
});
