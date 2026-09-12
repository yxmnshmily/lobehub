// @vitest-environment node
import { readFile } from 'node:fs/promises';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  agents,
  chatGroupInvitationLinks,
  chatGroups,
  chatGroupsAgents,
  chatGroupUserInvitations,
  chatGroupUserMemberships,
  messages,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentService } from '@/server/services/agent';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import { groupConversationRouter } from './groupConversation';
import { groupMembershipRouter } from './groupMembership';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: { ctx: unknown; next: (input: { ctx: unknown }) => unknown }) =>
    opts.next({ ctx: opts.ctx }),
  ),
}));

const db: LobeChatDatabase = await getTestDB();
const ownerId = 'group-membership-router-owner';
const memberId = 'group-membership-router-member';
const observerId = 'group-membership-router-observer';
const ownerEmail = 'owner-membership@example.test';
const memberEmail = 'member-membership@example.test';
const observerEmail = 'observer-membership@example.test';
const groupId = 'group-membership-router-group';
const otherGroupId = 'group-membership-router-other-group';
const assistantId = 'group-membership-router-assistant';
const groupIds = [groupId, otherGroupId];

const callerFor = (userId: string, workspaceId?: string | null) =>
  groupMembershipRouter.createCaller({ serverDB: db, userId, workspaceId } as never);
const conversationCallerFor = (userId: string) =>
  groupConversationRouter.createCaller({ serverDB: db, userId, workspaceId: null } as never);

const cleanup = async () => {
  await db.delete(messages).where(inArray(messages.groupId, groupIds));
  await db.delete(topics).where(inArray(topics.groupId, groupIds));
  await db
    .delete(chatGroupUserInvitations)
    .where(inArray(chatGroupUserInvitations.chatGroupId, groupIds));
  await db
    .delete(chatGroupUserMemberships)
    .where(inArray(chatGroupUserMemberships.chatGroupId, groupIds));
  await db.delete(chatGroups).where(inArray(chatGroups.id, groupIds));
  await db.delete(agents).where(eq(agents.id, assistantId));
  await db.delete(users).where(inArray(users.id, [ownerId, memberId, observerId]));
};

it('preserves an occupation separately from the member display name', async () => {
  await db
    .update(agents)
    .set({ name: '小旅', title: '旅行规划师', tags: ['旅行'] })
    .where(eq(agents.id, assistantId));
  try {
    const result = await callerFor(ownerId).listParticipants({ groupId });
    expect(result.assistants[0]).toMatchObject({ title: '小旅', subtitle: '旅行规划师' });
    expect(result.assistants[0].tags).toEqual(['旅行']);
    expect(result.assistants[0].updatedAt).toBeInstanceOf(Date);
    expect(result.assistants[0]).not.toHaveProperty('systemRole');
    expect(result.assistants[0]).toHaveProperty('pinned');
    expect(result.assistants[0]).toHaveProperty('sessionGroupId');
  } finally {
    await db
      .update(agents)
      .set({ name: null, title: '旅行规划', tags: [] })
      .where(eq(agents.id, assistantId));
  }
});

it('displays the same effective supervisor model used by hosted execution when storage has no override', async () => {
  await db
    .update(agents)
    .set({
      model: null,
      provider: null,
      agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
    })
    .where(eq(agents.id, assistantId));
  await db
    .update(chatGroupsAgents)
    .set({ role: 'supervisor' })
    .where(eq(chatGroupsAgents.agentId, assistantId));
  try {
    const runtime = await new AgentService(db, ownerId).getAgentConfig(assistantId);
    const participants = await callerFor(ownerId).listParticipants({ groupId });
    expect(runtime?.model).toBeTruthy();
    expect(participants.assistants[0]).toMatchObject({
      title: '旅游群',
      model: runtime?.model,
      provider: runtime?.provider,
    });
    expect(participants.assistants[0]).not.toHaveProperty('systemRole');
  } finally {
    await db
      .update(agents)
      .set({ model: 'deepseek-v4-flash', provider: 'deepseek', agencyConfig: null })
      .where(eq(agents.id, assistantId));
    await db
      .update(chatGroupsAgents)
      .set({ role: 'participant' })
      .where(eq(chatGroupsAgents.agentId, assistantId));
  }
});

beforeAll(async () => {
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS chat_group_user_memberships (
      chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      role text NOT NULL DEFAULT 'member',
      can_use_paid_ai boolean NOT NULL DEFAULT false,
      max_credits_per_request bigint,
      max_credits_per_period bigint,
      membership_version integer NOT NULL DEFAULT 1,
      joined_at timestamptz NOT NULL DEFAULT now(),
      removed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_group_id, user_id),
      CONSTRAINT chat_group_user_memberships_role_check CHECK (role = 'member'),
      CONSTRAINT chat_group_user_memberships_paid_ai_limits_check CHECK (
        (
          can_use_paid_ai = false
          AND max_credits_per_request IS NULL
          AND max_credits_per_period IS NULL
        ) OR (
          can_use_paid_ai = true
          AND max_credits_per_request IS NOT NULL
          AND max_credits_per_period IS NOT NULL
          AND max_credits_per_request > 0
          AND max_credits_per_period > 0
          AND max_credits_per_request <= max_credits_per_period
          AND max_credits_per_period <= 9007199254740991
        )
      ),
      CONSTRAINT chat_group_user_memberships_version_check CHECK (membership_version > 0)
    )
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS chat_group_user_invitations (
      id text PRIMARY KEY NOT NULL,
      chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      inviter_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      role text NOT NULL DEFAULT 'member',
      status text NOT NULL DEFAULT 'pending',
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chat_group_user_invitations_role_check CHECK (role = 'member'),
      CONSTRAINT chat_group_user_invitations_status_check
        CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      CONSTRAINT chat_group_user_invitations_token_hash_check
        CHECK (token_hash ~ '^[0-9a-f]{64}$')
    )
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_group_user_invitations_pending_unique
      ON chat_group_user_invitations(chat_group_id, invitee_user_id)
      WHERE status = 'pending'
  `),
  );
  await db.execute(
    sql.raw(`
    ALTER TABLE chat_group_user_invitations
      ADD COLUMN IF NOT EXISTS sponsorship_mode_snapshot text NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS sponsor_policy_version_snapshot integer,
      ADD COLUMN IF NOT EXISTS sponsor_request_limit_credits_snapshot bigint,
      ADD COLUMN IF NOT EXISTS sponsor_period_limit_credits_snapshot bigint
  `),
  );
  await cleanup();
  await db.insert(users).values([
    { email: ownerEmail, fullName: '群主', id: ownerId },
    { email: memberEmail, fullName: '成员', id: memberId },
    { email: observerEmail, fullName: '留群成员', id: observerId },
  ]);
  await db.insert(chatGroups).values([
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: groupId,
      title: '默认私人旅游群',
      userId: ownerId,
      visibility: 'private',
      workspaceId: null,
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: otherGroupId,
      title: '其他用户的旅游群',
      userId: memberId,
      visibility: 'private',
      workspaceId: null,
    },
  ]);
  await db.insert(agents).values({
    id: assistantId,
    userId: ownerId,
    title: '旅行规划',
    description: '帮助规划旅行路线',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    systemRole: 'private system instructions must not be exposed',
  });
  await db.insert(chatGroupsAgents).values({
    agentId: assistantId,
    chatGroupId: groupId,
    userId: ownerId,
  });
});

afterAll(cleanup);

describe('groupMembershipRouter', () => {
  it('registers the dedicated membership router once', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
    expect(
      source.match(/import \{ groupMembershipRouter \} from '\.\/groupMembership';/gu),
    ).toHaveLength(1);
    expect(source.match(/groupMembership: groupMembershipRouter,/gu)).toHaveLength(1);
  });

  it('completes invite to text-chat to immediate removal with two authenticated users', async () => {
    const owner = callerFor(ownerId);
    const member = callerFor(memberId);
    const created = await owner.createInvitation({ email: memberEmail, groupId });

    expect(created).toMatchObject({
      expiresAt: expect.any(Date),
      invitationId: expect.any(String),
      status: 'created',
      token: expect.stringMatching(/^[\w-]{43,}$/),
    });
    expect(Object.keys(created).sort()).toEqual(['expiresAt', 'invitationId', 'status', 'token']);

    const ownerPending = await owner.listPendingInvitations({ groupId });
    expect(ownerPending.items).toEqual([
      {
        expiresAt: created.expiresAt,
        invitationId: created.invitationId,
        maskedEmail: 'm***@example.test',
        sponsorship: {
          billingResponsibility: null,
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
        },
        status: 'pending',
      },
    ]);
    expect(JSON.stringify(ownerPending)).not.toMatch(/token|hash|userId/iu);

    const mine = await member.listMyPendingInvitations();
    expect(mine.items).toEqual([
      {
        avatar: null,
        billingMode: 'automatic_owner',
        expiresAt: created.expiresAt,
        groupId,
        invitationId: created.invitationId,
        ownerDisplayName: '群主',
        sponsorship: {
          billingResponsibility: null,
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
        },
        title: '默认私人旅游群',
      },
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/token|hash|ownerUserId|model|usage/iu);

    await expect(member.acceptInvitation({ token: created.token })).resolves.toEqual({
      groupId,
      membershipVersion: 1,
      status: 'accepted',
    });
    await expect(conversationCallerFor(memberId).listGroups()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId, kind: 'member', membershipVersion: 1 }),
      ]),
    );

    const topic = await conversationCallerFor(memberId).createTopic({
      groupId,
      idempotencyKey: 'membership-route-topic-1',
      title: '真人群聊',
    });
    await expect(
      conversationCallerFor(memberId).createTextMessage({
        content: '我是受邀成员',
        groupId,
        idempotencyKey: 'membership-route-message-1',
        topicId: topic.id,
      }),
    ).resolves.toMatchObject({ authorKind: 'self', content: '我是受邀成员' });

    await db
      .update(chatGroupUserMemberships)
      .set({
        canUsePaidAi: true,
        maxCreditsPerPeriod: 10_000,
        maxCreditsPerRequest: 1000,
      })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
    const members = await owner.listMembers({ groupId });
    expect(members.items).toEqual([
      expect.objectContaining({
        canUsePaidAi: true,
        displayName: '成员',
        maxCreditsPerPeriod: 10_000,
        maxCreditsPerRequest: 1000,
        memberUserId: memberId,
        membershipVersion: 1,
      }),
    ]);
    const participants = await member.listParticipants({ groupId });
    expect(participants.assistants[0]).not.toHaveProperty('pinned');
    expect(participants.assistants[0]).not.toHaveProperty('sessionGroupId');
    expect(participants).toEqual({
      assistants: [
        {
          avatar: null,
          description: '帮助规划旅行路线',
          id: assistantId,
          isSupervisor: false,
          model: 'deepseek-v4-flash',
          provider: 'deepseek',
          title: '旅行规划',
        },
      ],
      items: [
        {
          avatar: null,
          displayName: '群主',
          memberUserId: ownerId,
          membershipVersion: 0,
          role: 'owner',
        },
        {
          avatar: null,
          displayName: '成员',
          memberUserId: memberId,
          membershipVersion: 1,
          role: 'member',
        },
      ],
      nextOffset: null,
      viewerMembershipVersion: 1,
      viewerRole: 'member',
    });
    expect(JSON.stringify(participants)).not.toMatch(/email|credit|token|canUsePaidAi/iu);
    await expect(owner.listParticipants({ groupId, limit: 1 })).resolves.toMatchObject({
      items: [expect.objectContaining({ memberUserId: ownerId })],
      nextOffset: 1,
      viewerMembershipVersion: 0,
      viewerRole: 'owner',
    });
    await expect(member.listParticipants({ groupId, limit: 1, offset: 1 })).resolves.toMatchObject({
      items: [expect.objectContaining({ memberUserId: memberId })],
      nextOffset: null,
    });
    await owner.removeMember({
      expectedMembershipVersion: 1,
      groupId,
      memberUserId: memberId,
    });
    await expect(conversationCallerFor(memberId).listTopics({ groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_CONVERSATION_ACCESS_UNAVAILABLE',
    });
    await expect(member.listParticipants({ groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('marks default group invitations as automatic owner billing despite obsolete policy snapshots', async () => {
    const owner = callerFor(ownerId);
    const member = callerFor(memberId);
    const created = await owner.createInvitation({ email: memberEmail, groupId });
    await db
      .update(chatGroupUserInvitations)
      .set({
        sponsorPeriodLimitCreditsSnapshot: 3000,
        sponsorPolicyVersionSnapshot: 7,
        sponsorRequestLimitCreditsSnapshot: 500,
        sponsorshipModeSnapshot: 'group_owner',
      })
      .where(eq(chatGroupUserInvitations.id, created.invitationId));

    const ownerPending = await owner.listPendingInvitations({ groupId });
    const mine = await member.listMyPendingInvitations();
    for (const result of [ownerPending.items[0], mine.items[0]]) {
      expect(result).toMatchObject({
        sponsorship: {
          billingResponsibility: 'group_owner',
          maxCreditsPerPeriod: 3000,
          maxCreditsPerRequest: 500,
        },
      });
      expect(JSON.stringify(result)).not.toMatch(/ownerUser|payer|account|policyVersion/iu);
    }

    expect(mine.items[0].billingMode).toBe('automatic_owner');
    const accepted = await member.acceptMyInvitation({ invitationId: created.invitationId });
    await member.leaveGroup({ groupId, expectedMembershipVersion: accepted.membershipVersion });
  });

  it('accepts a listed invitation by id once and keeps cross-user, replay and expiry unavailable', async () => {
    const owner = callerFor(ownerId);
    const member = callerFor(memberId);
    const created = await owner.createInvitation({ email: memberEmail, groupId });
    const listed = await member.listMyPendingInvitations();
    const invitationId = listed.items[0]?.invitationId;

    expect(invitationId).toBe(created.invitationId);

    await expect(owner.acceptMyInvitation({ invitationId: invitationId! })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
    });

    const results = await Promise.allSettled([
      member.acceptMyInvitation({ invitationId: invitationId! }),
      member.acceptMyInvitation({ invitationId: invitationId! }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toEqual([
      expect.objectContaining({
        value: { groupId, membershipVersion: expect.any(Number), status: 'accepted' },
      }),
    ]);
    expect(JSON.stringify(fulfilled)).not.toMatch(/token|hash/iu);
    expect(rejected).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({
          code: 'NOT_FOUND',
          message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
        }),
      }),
    ]);

    const accepted = fulfilled[0] as PromiseFulfilledResult<{
      groupId: string;
      membershipVersion: number;
      status: 'accepted';
    }>;
    await owner.removeMember({
      expectedMembershipVersion: accepted.value.membershipVersion,
      groupId,
      memberUserId: memberId,
    });
    const expired = await owner.createInvitation({ email: memberEmail, groupId });
    await db
      .update(chatGroupUserInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatGroupUserInvitations.id, expired.invitationId));

    await expect(
      member.acceptMyInvitation({ invitationId: expired.invitationId }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
    });
  });

  it('invites by user ID, registered phone or contact email without bypassing owner checks', async () => {
    await db.update(users).set({ phone: '+8613800138000' }).where(eq(users.id, memberId));
    const owner = callerFor(ownerId);
    try {
      for (const contact of [
        memberId,
        '13800138000',
        '+86 138-0013-8000',
        memberEmail.toUpperCase(),
      ]) {
        const created = await owner.createInvitation({ contact, groupId });
        expect(created.status).toBe('created');
        const [row] = await db
          .select()
          .from(chatGroupUserInvitations)
          .where(eq(chatGroupUserInvitations.id, created.invitationId));
        expect(row.inviteeUserId).toBe(memberId);
        await owner.revokeInvitation({ groupId, invitationId: created.invitationId });
      }
      await expect(
        callerFor(observerId).createInvitation({ contact: '13800138000', groupId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        callerFor(observerId).createInvitation({ contact: memberId, groupId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        owner.createInvitation({ contact: 'user_missing', groupId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'GROUP_MEMBERSHIP_UNAVAILABLE' });
      await expect(
        owner.createInvitation({ contact: 'not a contact', groupId }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await db.update(users).set({ phone: '13800138000' }).where(eq(users.id, observerId));
      await expect(
        owner.createInvitation({ contact: '13800138000', groupId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await db
        .update(users)
        .set({ phone: null })
        .where(inArray(users.id, [memberId, observerId]));
    }
  });

  it('keeps unknown, duplicate, active-member, non-owner and cross-group creation neutral', async () => {
    const owner = callerFor(ownerId);
    const member = callerFor(memberId);
    const first = await owner.createInvitation({ email: memberEmail, groupId });

    const attempts = [
      owner.createInvitation({ email: 'unknown@example.test', groupId }),
      owner.createInvitation({ email: memberEmail, groupId }),
      member.createInvitation({ email: ownerEmail, groupId }),
      owner.createInvitation({ email: ownerEmail, groupId: otherGroupId }),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
      });
    }

    await owner.revokeInvitation({ groupId, invitationId: first.invitationId });
  });

  it('rejects expired tokens and replay with the same non-enumerating response', async () => {
    const created = await callerFor(ownerId).createInvitation({ email: memberEmail, groupId });
    await db
      .update(chatGroupUserInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatGroupUserInvitations.id, created.invitationId));

    const first = callerFor(memberId).acceptInvitation({ token: created.token });
    await expect(first).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
    });
    await expect(
      callerFor(memberId).acceptInvitation({ token: created.token }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
    });
  });

  it('supports revocation and voluntary departure without exposing token material', async () => {
    const owner = callerFor(ownerId);
    const member = callerFor(memberId);
    const revoked = await owner.createInvitation({ email: memberEmail, groupId });
    await expect(
      owner.revokeInvitation({ groupId, invitationId: revoked.invitationId }),
    ).resolves.toEqual({ status: 'revoked' });
    await expect(member.acceptInvitation({ token: revoked.token })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    const active = await owner.createInvitation({ email: memberEmail, groupId });
    const accepted = await member.acceptInvitation({ token: active.token });
    await expect(owner.createInvitation({ email: memberEmail, groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
    });
    await expect(
      member.leaveGroup({
        expectedMembershipVersion: accepted.membershipVersion,
        groupId: otherGroupId,
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_MEMBERSHIP_UNAVAILABLE',
    });
    await expect(
      member.leaveGroup({ expectedMembershipVersion: accepted.membershipVersion, groupId }),
    ).resolves.toEqual({ status: 'left' });
  });

  it('strictly rejects forged identities, roles, workspace, admin and paid-AI policy fields', async () => {
    const forgedFields = [
      { actorUserId: ownerId },
      { inviteeUserId: memberId },
      { ownerUserId: ownerId },
      { payerUserId: ownerId },
      { workspaceId: 'workspace-1' },
      { role: 'admin' },
      { admin: true },
      { canUsePaidAi: true },
      { maxCreditsPerRequest: 100 },
      { maxCreditsPerPeriod: 1000 },
      { sponsorPolicyVersionSnapshot: 1 },
      { sponsorshipModeSnapshot: 'group_owner' },
    ];

    for (const forged of forgedFields) {
      await expect(
        callerFor(ownerId).createInvitation({
          email: memberEmail,
          groupId,
          ...forged,
        } as never),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    await expect(
      callerFor(ownerId, 'workspace-1').listMyPendingInvitations(),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'GROUP_MEMBERSHIP_UNAVAILABLE' });
    await expect(
      callerFor(memberId).acceptMyInvitation({
        invitationId: 'forged-invitation-id',
        targetUserId: memberId,
      } as never),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it.each(['leave', 'kick'] as const)(
    'keeps prior history inaccessible after %s and reacceptance while preserving both owners history',
    async (departure) => {
      const owner = callerFor(ownerId);
      const member = callerFor(memberId);
      const ownerChat = conversationCallerFor(ownerId);
      const memberChat = conversationCallerFor(memberId);
      const observer = callerFor(observerId);
      const observerChat = conversationCallerFor(observerId);
      const observerInvitation = await owner.createInvitation({ email: observerEmail, groupId });
      const observerJoined = await observer.acceptMyInvitation({
        invitationId: observerInvitation.invitationId,
      });
      const invitation = await owner.createInvitation({ email: memberEmail, groupId });
      await expect(memberChat.listTopics({ groupId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const joined = await member.acceptMyInvitation({ invitationId: invitation.invitationId });
      await expect(
        observer.removeMember({
          groupId,
          memberUserId: memberId,
          expectedMembershipVersion: joined.membershipVersion,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const topic = await memberChat.createTopic({
        groupId,
        idempotencyKey: `lifecycle-${departure}-old-topic`,
        title: '入群期间的测试话题',
      });
      const message = await memberChat.createTextMessage({
        content: '退出前成员消息应留给群主',
        groupId,
        idempotencyKey: `lifecycle-${departure}-old-message`,
        topicId: topic.id,
      });
      const personalTopic = await memberChat.createTopic({
        groupId: otherGroupId,
        idempotencyKey: `lifecycle-${departure}-personal-topic`,
        title: '自己的永久话题',
      });
      await memberChat.createTextMessage({
        content: '自己群的消息始终保留',
        groupId: otherGroupId,
        idempotencyKey: `lifecycle-${departure}-personal-message`,
        topicId: personalTopic.id,
      });
      await expect(
        member.leaveGroup({
          groupId: otherGroupId,
          expectedMembershipVersion: joined.membershipVersion,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      if (departure === 'leave') {
        await member.leaveGroup({ groupId, expectedMembershipVersion: joined.membershipVersion });
      } else {
        await owner.removeMember({
          groupId,
          memberUserId: memberId,
          expectedMembershipVersion: joined.membershipVersion,
        });
      }
      expect((await memberChat.listGroups()).map((item) => item.groupId)).not.toContain(groupId);
      await expect(
        memberChat.listTextMessages({ groupId, topicId: topic.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await ownerChat.listTextMessages({ groupId, topicId: topic.id })).items).toEqual([
        expect.objectContaining({ content: message.content }),
      ]);
      expect((await observerChat.listTextMessages({ groupId, topicId: topic.id })).items).toEqual([
        expect.objectContaining({ authorKind: 'member', content: message.content }),
      ]);

      const reinvitation = await owner.createInvitation({ email: memberEmail, groupId });
      await expect(member.listParticipants({ groupId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      const rejoined = await member.acceptMyInvitation({ invitationId: reinvitation.invitationId });
      expect(rejoined.membershipVersion).toBeGreaterThan(joined.membershipVersion);
      expect(
        (await memberChat.listTopics({ groupId, recent: true })).items.map((item) => item.id),
      ).not.toContain(topic.id);
      await expect(
        memberChat.listTextMessages({ groupId, topicId: topic.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        memberChat.createTextMessage({
          content: '旧链接不能恢复访问',
          groupId,
          idempotencyKey: `lifecycle-${departure}-old-link`,
          topicId: topic.id,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        member.leaveGroup({
          groupId,
          expectedMembershipVersion: joined.membershipVersion,
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await ownerChat.listTextMessages({ groupId, topicId: topic.id })).items).toEqual([
        expect.objectContaining({ content: '退出前成员消息应留给群主' }),
      ]);
      expect((await observerChat.listTextMessages({ groupId, topicId: topic.id })).items).toEqual([
        expect.objectContaining({ authorKind: 'member', content: '退出前成员消息应留给群主' }),
      ]);
      expect(
        (await memberChat.listTextMessages({ groupId: otherGroupId, topicId: personalTopic.id }))
          .items,
      ).toEqual([expect.objectContaining({ content: '自己群的消息始终保留' })]);
      const newTopic = await memberChat.createTopic({
        groupId,
        idempotencyKey: `lifecycle-${departure}-new-topic`,
        title: '重新加入后的话题',
      });
      await memberChat.createTextMessage({
        content: '重新加入后正常交流',
        groupId,
        idempotencyKey: `lifecycle-${departure}-new-message`,
        topicId: newTopic.id,
      });
      expect((await memberChat.listTextMessages({ groupId, topicId: newTopic.id })).items).toEqual([
        expect.objectContaining({ content: '重新加入后正常交流' }),
      ]);
      await member.leaveGroup({ groupId, expectedMembershipVersion: rejoined.membershipVersion });
      await observer.leaveGroup({
        groupId,
        expectedMembershipVersion: observerJoined.membershipVersion,
      });
    },
  );

  it('does not import or invoke AI, budget, billing, or mail services', async () => {
    const source = await readFile(new URL('./groupMembership.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/aiAgent|sharedBudget|platformUsageBilling|sendMail|mailer/iu);

    const entries = await db
      .select({ status: chatGroupUserInvitations.status })
      .from(chatGroupUserInvitations)
      .where(
        and(
          eq(chatGroupUserInvitations.chatGroupId, groupId),
          eq(chatGroupUserInvitations.status, 'pending'),
        ),
      );
    expect(entries).toHaveLength(0);
  });
});

describe('transferable invitation links', () => {
  beforeEach(async () => {
    await db
      .delete(chatGroupInvitationLinks)
      .where(eq(chatGroupInvitationLinks.chatGroupId, groupId));
    await db
      .delete(chatGroupUserMemberships)
      .where(eq(chatGroupUserMemberships.chatGroupId, groupId));
  });
  it('lets registered users confirm a link without exposing group messages or granting owner rights', async () => {
    const owner = callerFor(ownerId);
    const member = callerFor(memberId);
    const issued = await owner.createInvitationLink({ groupId });
    expect(issued.token).toHaveLength(43);
    const anonymous = callerFor(undefined as never);
    expect(await anonymous.previewInvitationLink({ token: issued.token })).toEqual({
      title: expect.any(String),
    });
    await expect(anonymous.joinInvitationLink({ token: issued.token })).rejects.toBeTruthy();
    await expect(member.createInvitationLink({ groupId })).rejects.toBeTruthy();
    await expect(member.revokeInvitationLinks({ groupId })).rejects.toBeTruthy();
    const results = await Promise.all([
      member.joinInvitationLink({ token: issued.token }),
      member.joinInvitationLink({ token: issued.token }),
    ]);
    expect(results).toEqual([{ groupId }, { groupId }]);
    const rows = await db
      .select()
      .from(chatGroupUserMemberships)
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'member', canUsePaidAi: false });
    const stored = await db
      .select()
      .from(chatGroupInvitationLinks)
      .where(eq(chatGroupInvitationLinks.chatGroupId, groupId));
    expect(stored[0].tokenHash).not.toBe(issued.token);
    await owner.revokeInvitationLinks({ groupId });
    await expect(anonymous.previewInvitationLink({ token: issued.token })).rejects.toBeTruthy();
    await expect(
      callerFor(observerId).joinInvitationLink({ token: issued.token }),
    ).rejects.toBeTruthy();
    expect((await member.listParticipants({ groupId })).viewerRole).toBe('member');
  });
  it('rejects expired, forged links and prevents removed members from joining again through a link', async () => {
    const owner = callerFor(ownerId);
    const issued = await owner.createInvitationLink({ groupId });
    await callerFor(memberId).joinInvitationLink({ token: issued.token });
    await db
      .update(chatGroupUserMemberships)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(chatGroupUserMemberships.chatGroupId, groupId),
          eq(chatGroupUserMemberships.userId, memberId),
        ),
      );
    await expect(
      callerFor(memberId).joinInvitationLink({ token: issued.token }),
    ).rejects.toBeTruthy();
    await expect(
      callerFor(observerId).joinInvitationLink({ token: 'a'.repeat(43) }),
    ).rejects.toBeTruthy();
    await db
      .update(chatGroupInvitationLinks)
      .set({ expiresAt: new Date(0) })
      .where(eq(chatGroupInvitationLinks.chatGroupId, groupId));
    await expect(
      callerFor(observerId).joinInvitationLink({ token: issued.token }),
    ).rejects.toBeTruthy();
    await expect(owner.previewInvitationLink({ token: issued.token })).rejects.toBeTruthy();
  });
});
