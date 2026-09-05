// @vitest-environment node
import { and, asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agents, chatGroups, chatGroupsAgents, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import {
  PlatformUserGroupAdminConflictError,
  PlatformUserGroupAdminModel,
  PlatformUserGroupAdminNotFoundError,
  PlatformUserGroupAdminPreconditionError,
  PlatformUserGroupAdminQueryError,
} from '../platformUserGroupAdmin';

const db: LobeChatDatabase = await getTestDB();
const targetUserId = 'platform-group-admin-target';
const otherUserId = 'platform-group-admin-other';

const createWritableGroup = async (prefix: string, updatedAt: Date) => {
  const groupId = `${prefix}-group`;
  const supervisorId = `${prefix}-supervisor`;
  const firstMemberId = `${prefix}-member-a`;
  const secondMemberId = `${prefix}-member-b`;
  await db.insert(chatGroups).values({
    clientId: groupId,
    config: {
      allowDM: true,
      memberSlots: [
        {
          agentId: supervisorId,
          configurable: true,
          key: 'supervisor',
          label: 'Supervisor',
          role: 'supervisor',
          status: 'configured',
        },
      ],
      openingMessage: 'Old opening',
      openingQuestions: ['Old question'],
      revealDM: true,
    },
    content: 'Old system instruction',
    id: groupId,
    updatedAt,
    userId: targetUserId,
    visibility: 'private',
  });
  await db.insert(agents).values([
    {
      clientId: supervisorId,
      id: supervisorId,
      name: 'Supervisor',
      slug: supervisorId,
      userId: targetUserId,
      virtual: true,
    },
    {
      clientId: firstMemberId,
      id: firstMemberId,
      name: 'Member A',
      slug: firstMemberId,
      userId: targetUserId,
    },
    {
      clientId: secondMemberId,
      id: secondMemberId,
      name: 'Member B',
      slug: secondMemberId,
      userId: targetUserId,
    },
  ]);
  await db.insert(chatGroupsAgents).values([
    {
      agentId: supervisorId,
      chatGroupId: groupId,
      enabled: true,
      order: 0,
      role: 'supervisor',
      userId: targetUserId,
    },
    {
      agentId: firstMemberId,
      chatGroupId: groupId,
      enabled: true,
      order: 1,
      role: 'participant',
      userId: targetUserId,
    },
    {
      agentId: secondMemberId,
      chatGroupId: groupId,
      enabled: true,
      order: 2,
      role: 'participant',
      userId: targetUserId,
    },
  ]);
  return { firstMemberId, groupId, secondMemberId, supervisorId };
};

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, targetUserId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.insert(users).values([{ id: targetUserId }, { id: otherUserId }]);
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, targetUserId));
  await db.delete(users).where(eq(users.id, otherUserId));
});

describe('PlatformUserGroupAdminModel', () => {
  it('lists only target-user personal private groups with a stable updatedAt and id cursor', async () => {
    const workspaceId = 'platform-group-admin-list-workspace';
    const sharedUpdatedAt = new Date('2026-09-03T10:00:00.000Z');
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Team workspace',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(chatGroups).values([
      {
        clientId: 'platform-group-admin-private-a',
        config: { systemPrompt: 'PRIVATE_GROUP_CONFIG_MUST_NOT_LEAK' },
        content: 'PRIVATE_GROUP_PROMPT_MUST_NOT_LEAK',
        editorData: { secret: 'PRIVATE_GROUP_EDITOR_DATA_MUST_NOT_LEAK' },
        id: 'platform-group-admin-private-a',
        title: 'Private A',
        updatedAt: sharedUpdatedAt,
        userId: targetUserId,
        visibility: 'private',
      },
      {
        clientId: 'platform-group-admin-private-b',
        id: 'platform-group-admin-private-b',
        title: 'Private B',
        updatedAt: sharedUpdatedAt,
        userId: targetUserId,
        visibility: 'private',
      },
      {
        clientId: 'platform-group-admin-private-old',
        id: 'platform-group-admin-private-old',
        title: 'Private old',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
      },
      {
        clientId: 'platform-group-admin-public-must-not-leak',
        id: 'platform-group-admin-public-must-not-leak',
        title: 'Public must not leak',
        updatedAt: new Date('2026-09-03T13:00:00.000Z'),
        userId: targetUserId,
        visibility: 'public',
      },
      {
        clientId: 'platform-group-admin-team-must-not-leak',
        id: 'platform-group-admin-team-must-not-leak',
        title: 'Team must not leak',
        updatedAt: new Date('2026-09-03T14:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
        workspaceId,
      },
      {
        clientId: 'platform-group-admin-other-must-not-leak',
        id: 'platform-group-admin-other-must-not-leak',
        title: 'Other user must not leak',
        updatedAt: new Date('2026-09-03T15:00:00.000Z'),
        userId: otherUserId,
        visibility: 'private',
      },
    ]);

    const model = new PlatformUserGroupAdminModel(db);
    const firstPage = await model.listPrivateGroups(targetUserId, undefined, 1);
    const secondPage = await model.listPrivateGroups(targetUserId, firstPage.nextCursor!, 1);
    const thirdPage = await model.listPrivateGroups(targetUserId, secondPage.nextCursor!, 1);

    expect(firstPage.items.map(({ id }) => id)).toEqual(['platform-group-admin-private-b']);
    expect(secondPage.items.map(({ id }) => id)).toEqual(['platform-group-admin-private-a']);
    expect(thirdPage.items.map(({ id }) => id)).toEqual(['platform-group-admin-private-old']);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.nextCursor).toEqual(expect.any(String));
    expect(thirdPage.nextCursor).toBeNull();
    for (const item of [...firstPage.items, ...secondPage.items, ...thirdPage.items]) {
      expect(Object.keys(item).sort()).toEqual([
        'avatar',
        'clientId',
        'createdAt',
        'description',
        'id',
        'title',
        'updatedAt',
      ]);
    }
    expect(JSON.stringify([firstPage, secondPage, thirdPage])).not.toMatch(
      /MUST_NOT_LEAK|config|content|editorData|workspaceId|userId/,
    );
  });

  it('returns undefined for missing, cross-user, team-workspace, and public groups', async () => {
    const workspaceId = 'platform-group-admin-scope-workspace';
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Scope workspace',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(chatGroups).values([
      {
        clientId: 'platform-group-admin-scope-valid',
        id: 'platform-group-admin-scope-valid',
        userId: targetUserId,
        visibility: 'private',
      },
      {
        clientId: 'platform-group-admin-scope-other',
        id: 'platform-group-admin-scope-other',
        userId: otherUserId,
        visibility: 'private',
      },
      {
        clientId: 'platform-group-admin-scope-team',
        id: 'platform-group-admin-scope-team',
        userId: targetUserId,
        visibility: 'private',
        workspaceId,
      },
      {
        clientId: 'platform-group-admin-scope-public',
        id: 'platform-group-admin-scope-public',
        userId: targetUserId,
        visibility: 'public',
      },
    ]);

    const model = new PlatformUserGroupAdminModel(db);

    await expect(
      model.getPrivateGroupMembers(targetUserId, 'platform-group-admin-scope-valid'),
    ).resolves.toEqual({ items: [], nextCursor: null });
    await expect(
      model.getPrivateGroupMembers(targetUserId, 'platform-group-admin-scope-missing'),
    ).resolves.toBeUndefined();
    await expect(
      model.getPrivateGroupMembers(targetUserId, 'platform-group-admin-scope-other'),
    ).resolves.toBeUndefined();
    await expect(
      model.getPrivateGroupMembers(targetUserId, 'platform-group-admin-scope-team'),
    ).resolves.toBeUndefined();
    await expect(
      model.getPrivateGroupMembers(targetUserId, 'platform-group-admin-scope-public'),
    ).resolves.toBeUndefined();
  });

  it('paginates only personal target-user agents and returns a strict safe member projection', async () => {
    const workspaceId = 'platform-group-admin-member-workspace';
    const groupId = 'platform-group-admin-member-group';
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Member workspace',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(chatGroups).values({
      clientId: groupId,
      id: groupId,
      userId: targetUserId,
      visibility: 'private',
    });
    await db.insert(agents).values([
      {
        agencyConfig: { enabled: true },
        avatar: 'personal-a.png',
        clientId: 'platform-group-admin-agent-a',
        description: 'Personal A',
        editorData: { secret: 'AGENT_A_EDITOR_DATA_MUST_NOT_LEAK' },
        id: 'platform-group-admin-agent-a',
        model: 'AGENT_A_MODEL_MUST_NOT_LEAK',
        name: 'Agent A',
        params: { secret: 'AGENT_A_PARAMS_MUST_NOT_LEAK' },
        provider: 'AGENT_A_PROVIDER_MUST_NOT_LEAK',
        slug: 'platform-group-admin-agent-a',
        systemRole: 'AGENT_A_SYSTEM_PROMPT_MUST_NOT_LEAK',
        userId: targetUserId,
      },
      {
        avatar: 'personal-b.png',
        clientId: 'platform-group-admin-agent-b',
        description: 'Personal B',
        id: 'platform-group-admin-agent-b',
        name: 'Agent B',
        slug: 'platform-group-admin-agent-b',
        userId: targetUserId,
      },
      {
        clientId: 'platform-group-admin-agent-other',
        id: 'platform-group-admin-agent-other',
        name: 'Other agent must not leak',
        slug: 'platform-group-admin-agent-other',
        systemRole: 'OTHER_AGENT_PROMPT_MUST_NOT_LEAK',
        userId: otherUserId,
      },
      {
        clientId: 'platform-group-admin-agent-team',
        id: 'platform-group-admin-agent-team',
        name: 'Team agent must not leak',
        slug: 'platform-group-admin-agent-team',
        systemRole: 'TEAM_AGENT_PROMPT_MUST_NOT_LEAK',
        userId: targetUserId,
        workspaceId,
      },
    ]);
    await db.insert(chatGroupsAgents).values([
      {
        agentId: 'platform-group-admin-agent-a',
        chatGroupId: groupId,
        enabled: true,
        order: 1,
        role: 'supervisor',
        userId: targetUserId,
      },
      {
        agentId: 'platform-group-admin-agent-b',
        chatGroupId: groupId,
        enabled: false,
        order: 2,
        role: 'participant',
        userId: targetUserId,
      },
      {
        agentId: 'platform-group-admin-agent-other',
        chatGroupId: groupId,
        enabled: true,
        order: 0,
        role: 'participant',
        userId: targetUserId,
      },
      {
        agentId: 'platform-group-admin-agent-team',
        chatGroupId: groupId,
        enabled: true,
        order: 0,
        role: 'participant',
        userId: targetUserId,
      },
    ]);

    const model = new PlatformUserGroupAdminModel(db);
    const firstPage = await model.getPrivateGroupMembers(targetUserId, groupId, undefined, 1);
    const secondPage = await model.getPrivateGroupMembers(
      targetUserId,
      groupId,
      firstPage!.nextCursor!,
      1,
    );

    expect(firstPage).toEqual({
      items: [
        {
          agentId: 'platform-group-admin-agent-a',
          avatar: 'personal-a.png',
          clientId: 'platform-group-admin-agent-a',
          description: 'Personal A',
          enabled: true,
          name: 'Agent A',
          order: 1,
          role: 'supervisor',
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(secondPage).toEqual({
      items: [
        {
          agentId: 'platform-group-admin-agent-b',
          avatar: 'personal-b.png',
          clientId: 'platform-group-admin-agent-b',
          description: 'Personal B',
          enabled: false,
          name: 'Agent B',
          order: 2,
          role: 'participant',
        },
      ],
      nextCursor: null,
    });
    expect(JSON.stringify([firstPage, secondPage])).not.toMatch(
      /MUST_NOT_LEAK|agencyConfig|config|editorData|model|params|provider|secret|systemRole|workspaceId|userId/,
    );
  });

  it('atomically toggles a personal member and never disables the supervisor', async () => {
    const initialVersion = new Date('2099-01-01T00:00:00.000Z');
    const { firstMemberId, groupId, supervisorId } = await createWritableGroup(
      'platform-group-admin-toggle',
      initialVersion,
    );
    const model = new PlatformUserGroupAdminModel(db);

    const result = await model.setPrivateGroupMemberEnabled({
      agentId: firstMemberId,
      enabled: false,
      expectedGroupUpdatedAt: initialVersion,
      groupId,
      targetUserId,
    });

    expect(result.groupUpdatedAt).toEqual(new Date('2099-01-01T00:00:00.001Z'));
    expect(result.member).toMatchObject({ agentId: firstMemberId, enabled: false });
    const [memberAfterToggle] = await db
      .select({ enabled: chatGroupsAgents.enabled })
      .from(chatGroupsAgents)
      .where(
        and(eq(chatGroupsAgents.chatGroupId, groupId), eq(chatGroupsAgents.agentId, firstMemberId)),
      );
    expect(memberAfterToggle.enabled).toBe(false);

    await expect(
      model.setPrivateGroupMemberEnabled({
        agentId: supervisorId,
        enabled: false,
        expectedGroupUpdatedAt: result.groupUpdatedAt,
        groupId,
        targetUserId,
      }),
    ).rejects.toBeInstanceOf(PlatformUserGroupAdminPreconditionError);
    const [groupAfterRejectedToggle] = await db
      .select({ updatedAt: chatGroups.updatedAt })
      .from(chatGroups)
      .where(eq(chatGroups.id, groupId));
    expect(groupAfterRejectedToggle.updatedAt).toEqual(result.groupUpdatedAt);
  });

  it('fails member mutations closed for foreign agents and non-personal-private groups', async () => {
    const initialVersion = new Date('2099-01-02T00:00:00.000Z');
    const { groupId } = await createWritableGroup(
      'platform-group-admin-scope-write',
      initialVersion,
    );
    const otherAgentId = 'platform-group-admin-scope-write-other-agent';
    const workspaceId = 'platform-group-admin-scope-write-workspace';
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Write scope workspace',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(agents).values({
      clientId: otherAgentId,
      id: otherAgentId,
      name: 'Other agent',
      slug: otherAgentId,
      userId: otherUserId,
    });
    await db.insert(chatGroupsAgents).values({
      agentId: otherAgentId,
      chatGroupId: groupId,
      enabled: true,
      order: 3,
      role: 'participant',
      userId: targetUserId,
    });
    await db.insert(chatGroups).values([
      {
        clientId: 'platform-group-admin-scope-write-public',
        id: 'platform-group-admin-scope-write-public',
        updatedAt: initialVersion,
        userId: targetUserId,
        visibility: 'public',
      },
      {
        clientId: 'platform-group-admin-scope-write-team',
        id: 'platform-group-admin-scope-write-team',
        updatedAt: initialVersion,
        userId: targetUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    const model = new PlatformUserGroupAdminModel(db);

    await expect(
      model.setPrivateGroupMemberEnabled({
        agentId: otherAgentId,
        enabled: false,
        expectedGroupUpdatedAt: initialVersion,
        groupId,
        targetUserId,
      }),
    ).rejects.toBeInstanceOf(PlatformUserGroupAdminNotFoundError);
    for (const invalidGroupId of [
      'platform-group-admin-scope-write-public',
      'platform-group-admin-scope-write-team',
    ]) {
      await expect(
        model.setPrivateGroupMemberEnabled({
          agentId: otherAgentId,
          enabled: false,
          expectedGroupUpdatedAt: initialVersion,
          groupId: invalidGroupId,
          targetUserId,
        }),
      ).rejects.toBeInstanceOf(PlatformUserGroupAdminNotFoundError);
    }
    const [groupAfterRejectedWrites] = await db
      .select({ updatedAt: chatGroups.updatedAt })
      .from(chatGroups)
      .where(eq(chatGroups.id, groupId));
    expect(groupAfterRejectedWrites.updatedAt).toEqual(initialVersion);
  });

  it('reorders a complete roster atomically and rejects invalid arrangements without partial writes', async () => {
    const initialVersion = new Date('2099-01-03T00:00:00.000Z');
    const { firstMemberId, groupId, secondMemberId, supervisorId } = await createWritableGroup(
      'platform-group-admin-reorder',
      initialVersion,
    );
    const model = new PlatformUserGroupAdminModel(db);
    const invalidOrders = [
      [supervisorId, firstMemberId, firstMemberId],
      [firstMemberId, supervisorId, secondMemberId],
      [supervisorId, firstMemberId],
    ];

    for (const orderedAgentIds of invalidOrders) {
      await expect(
        model.reorderPrivateGroupMembers({
          expectedGroupUpdatedAt: initialVersion,
          groupId,
          orderedAgentIds,
          targetUserId,
        }),
      ).rejects.toBeInstanceOf(PlatformUserGroupAdminPreconditionError);
    }
    const unchangedRows = await db
      .select({ agentId: chatGroupsAgents.agentId, order: chatGroupsAgents.order })
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, groupId))
      .orderBy(asc(chatGroupsAgents.order));
    expect(unchangedRows).toEqual([
      { agentId: supervisorId, order: 0 },
      { agentId: firstMemberId, order: 1 },
      { agentId: secondMemberId, order: 2 },
    ]);

    const result = await model.reorderPrivateGroupMembers({
      expectedGroupUpdatedAt: initialVersion,
      groupId,
      orderedAgentIds: [supervisorId, secondMemberId, firstMemberId],
      targetUserId,
    });
    const reorderedRows = await db
      .select({ agentId: chatGroupsAgents.agentId, order: chatGroupsAgents.order })
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.chatGroupId, groupId))
      .orderBy(asc(chatGroupsAgents.order));
    expect(reorderedRows).toEqual([
      { agentId: supervisorId, order: 0 },
      { agentId: secondMemberId, order: 1 },
      { agentId: firstMemberId, order: 2 },
    ]);

    const attempts = await Promise.allSettled([
      model.reorderPrivateGroupMembers({
        expectedGroupUpdatedAt: result.groupUpdatedAt,
        groupId,
        orderedAgentIds: [supervisorId, secondMemberId, firstMemberId],
        targetUserId,
      }),
      model.reorderPrivateGroupMembers({
        expectedGroupUpdatedAt: result.groupUpdatedAt,
        groupId,
        orderedAgentIds: [supervisorId, secondMemberId, firstMemberId],
        targetUserId,
      }),
    ]);
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      (attempts.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason,
    ).toBeInstanceOf(PlatformUserGroupAdminConflictError);
  });

  it('updates only the template allowlist while preserving unrelated group config', async () => {
    const initialVersion = new Date('2099-01-04T00:00:00.000Z');
    const { groupId } = await createWritableGroup('platform-group-admin-template', initialVersion);
    const model = new PlatformUserGroupAdminModel(db);

    const result = await model.updatePrivateGroupTemplate({
      expectedGroupUpdatedAt: initialVersion,
      groupId,
      patch: {
        content: 'New system instruction',
        openingMessage: 'New opening',
        openingQuestions: ['Question A', 'Question B'],
      },
      targetUserId,
    });
    expect(result.groupUpdatedAt).toEqual(new Date('2099-01-04T00:00:00.001Z'));
    const [updated] = await db
      .select({ config: chatGroups.config, content: chatGroups.content })
      .from(chatGroups)
      .where(eq(chatGroups.id, groupId));
    expect(updated.content).toBe('New system instruction');
    expect(updated.config).toMatchObject({
      allowDM: true,
      memberSlots: [expect.objectContaining({ key: 'supervisor' })],
      openingMessage: 'New opening',
      openingQuestions: ['Question A', 'Question B'],
      revealDM: true,
    });

    await expect(
      model.updatePrivateGroupTemplate({
        expectedGroupUpdatedAt: result.groupUpdatedAt,
        groupId,
        patch: {
          config: { systemPrompt: 'WIDE_CONFIG_MUST_NOT_BE_WRITTEN' },
          editorData: { secret: 'EDITOR_DATA_MUST_NOT_BE_WRITTEN' },
        },
        targetUserId,
      } as never),
    ).rejects.toBeInstanceOf(PlatformUserGroupAdminQueryError);
    const [afterRejectedWidePatch] = await db
      .select({
        config: chatGroups.config,
        content: chatGroups.content,
        updatedAt: chatGroups.updatedAt,
      })
      .from(chatGroups)
      .where(eq(chatGroups.id, groupId));
    expect(afterRejectedWidePatch).toEqual({
      config: updated.config,
      content: 'New system instruction',
      updatedAt: result.groupUpdatedAt,
    });
  });

  it('rejects invalid group and member pagination inputs', async () => {
    const model = new PlatformUserGroupAdminModel(db);

    await expect(model.listPrivateGroups(targetUserId, undefined, 0)).rejects.toBeInstanceOf(
      PlatformUserGroupAdminQueryError,
    );
    await expect(model.listPrivateGroups(targetUserId, undefined, 51)).rejects.toBeInstanceOf(
      PlatformUserGroupAdminQueryError,
    );
    await expect(model.listPrivateGroups(targetUserId, 'bad-cursor')).rejects.toBeInstanceOf(
      PlatformUserGroupAdminQueryError,
    );
    await expect(
      model.getPrivateGroupMembers(targetUserId, 'missing', undefined, 51),
    ).rejects.toBeInstanceOf(PlatformUserGroupAdminQueryError);
  });
});
