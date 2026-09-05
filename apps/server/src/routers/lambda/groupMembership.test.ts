// @vitest-environment node
import { readFile } from 'node:fs/promises';

import type { LobeChatDatabase } from '@lobechat/database';
import {
  chatGroups,
  chatGroupUserInvitations,
  chatGroupUserMemberships,
  messages,
  topics,
  users,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
const ownerEmail = 'owner-membership@example.test';
const memberEmail = 'member-membership@example.test';
const groupId = 'group-membership-router-group';
const otherGroupId = 'group-membership-router-other-group';
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
  await db.delete(users).where(inArray(users.id, [ownerId, memberId]));
};

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
        expiresAt: created.expiresAt,
        groupId,
        invitationId: created.invitationId,
        sponsorship: {
          billingResponsibility: null,
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
        },
        title: '默认私人旅游群',
      },
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/token|hash|owner|model|usage/iu);

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
    await owner.removeMember({
      expectedMembershipVersion: 1,
      groupId,
      memberUserId: memberId,
    });
    await expect(conversationCallerFor(memberId).listTopics({ groupId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'GROUP_CONVERSATION_ACCESS_UNAVAILABLE',
    });
  });

  it('lists only safe owner-sponsored invitation limits and maps snapshot drift to conflict', async () => {
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

    await expect(
      member.acceptMyInvitation({ invitationId: created.invitationId }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'GROUP_MEMBERSHIP_CONFLICT' });
    await owner.revokeInvitation({ groupId, invitationId: created.invitationId });
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
