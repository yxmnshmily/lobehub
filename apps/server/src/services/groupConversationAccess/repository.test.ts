// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { chatGroups, chatGroupUserMemberships, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import { GROUP_CONVERSATION_ACCESS_UNAVAILABLE } from './principal';
import { GroupConversationAccessRepository } from './repository';

const db: LobeChatDatabase = await getTestDB();

const ownerId = 'group-repository-owner';
const memberId = 'group-repository-member';
const removedMemberId = 'group-repository-removed';
const outsiderId = 'group-repository-outsider';
const publicOwnerId = 'group-repository-public-owner';
const customOwnerId = 'group-repository-custom-owner';
const otherOwnerId = 'group-repository-other-owner';
const userIds = [
  ownerId,
  memberId,
  removedMemberId,
  outsiderId,
  publicOwnerId,
  customOwnerId,
  otherOwnerId,
];

const ownerGroupId = 'group-repository-owner-default';
const memberOwnGroupId = 'group-repository-member-default';
const otherPrivateGroupId = 'group-repository-other-default';
const publicGroupId = 'group-repository-public-default';
const customGroupId = 'group-repository-private-custom';
const groupIds = [
  ownerGroupId,
  memberOwnGroupId,
  otherPrivateGroupId,
  publicGroupId,
  customGroupId,
];
const joinedAt = new Date('2026-09-04T02:00:00.000Z');

const cleanup = async () => {
  await db
    .delete(chatGroupUserMemberships)
    .where(inArray(chatGroupUserMemberships.chatGroupId, groupIds));
  await db.delete(chatGroups).where(inArray(chatGroups.id, groupIds));
  await db.delete(users).where(inArray(users.id, userIds));
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
    sql.raw(`CREATE INDEX IF NOT EXISTS chat_group_user_memberships_user_id_idx
      ON chat_group_user_memberships(user_id)`),
  );
  await cleanup();
  await db.insert(users).values(userIds.map((id) => ({ email: `${id}@example.test`, id })));
  await db.update(users).set({ fullName: '旅游策划师' }).where(eq(users.id, ownerId));
  await db.insert(chatGroups).values([
    {
      avatar: 'owner-avatar',
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      config: { memberSlots: [] },
      content: 'must not be returned',
      id: ownerGroupId,
      title: '群主的旅游群',
      userId: ownerId,
      visibility: 'private',
    },
    {
      avatar: 'member-avatar',
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: memberOwnGroupId,
      title: '成员自己的旅游群',
      userId: memberId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: otherPrivateGroupId,
      title: '其他用户的旅游群',
      userId: otherOwnerId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: publicGroupId,
      title: '公开旅游群',
      userId: publicOwnerId,
      visibility: 'public',
    },
    {
      clientId: 'custom-group',
      id: customGroupId,
      title: '私人自定义群',
      userId: customOwnerId,
      visibility: 'private',
    },
  ]);
  await db.insert(chatGroupUserMemberships).values([
    {
      chatGroupId: ownerGroupId,
      invitedByUserId: ownerId,
      joinedAt,
      membershipVersion: 5,
      userId: memberId,
    },
    {
      chatGroupId: ownerGroupId,
      invitedByUserId: ownerId,
      membershipVersion: 6,
      removedAt: new Date('2026-09-04T03:00:00.000Z'),
      userId: removedMemberId,
    },
  ]);
});

afterAll(cleanup);

describe('GroupConversationAccessRepository', () => {
  const repository = new GroupConversationAccessRepository(db);

  it.each([
    [
      '昵称优先（含微信昵称）',
      ' 微信昵称 ',
      'account',
      'name@example.test',
      '13800000000',
      '微信昵称',
    ],
    ['用户名优先', ' ', ' account ', 'name@example.test', '13800000000', 'account'],
    ['邮箱兜底', null, ' ', ' name@example.test ', '13800000000', 'name@example.test'],
    ['手机号兜底', null, null, ' ', ' 13800000000 ', '13800000000'],
    ['忽略手机占位邮箱', null, null, 'account@phone.invalid', '13800000000', '13800000000'],
    ['忽略微信占位邮箱', null, null, 'openid@wechat.lobehub', null, null],
    ['全部未设置', null, null, null, null, null],
  ])('%s', async (_label, fullName, username, email, phone, expected) => {
    try {
      await db
        .update(users)
        .set({ fullName, username, email, phone })
        .where(eq(users.id, memberId));
      const summary = await repository.getAccessibleGroupSummary(memberId, memberOwnGroupId);
      expect(summary.ownerDisplayName).toBe(expected);
    } finally {
      await db
        .update(users)
        .set({ fullName: null, username: null, email: null, phone: null })
        .where(eq(users.id, memberId));
    }
  });

  it('lists only safe summaries for groups the actor owns or actively joined', async () => {
    await expect(repository.listAccessibleGroupSummaries(memberId)).resolves.toEqual([
      {
        avatar: 'member-avatar',
        groupId: memberOwnGroupId,
        joinedAt: null,
        kind: 'owner',
        membershipVersion: 0,
        ownerDisplayName: null,
        resourceOwnerUserId: memberId,
        title: '成员自己的旅游群',
      },
      {
        avatar: 'owner-avatar',
        groupId: ownerGroupId,
        joinedAt,
        kind: 'member',
        membershipVersion: 5,
        ownerDisplayName: '旅游策划师',
        resourceOwnerUserId: ownerId,
        title: '群主的旅游群',
      },
    ]);
  });

  it('returns an empty list for an outsider or removed member', async () => {
    await expect(repository.listAccessibleGroupSummaries(outsiderId)).resolves.toEqual([]);
    await expect(repository.listAccessibleGroupSummaries(removedMemberId)).resolves.toEqual([]);
  });

  it('gets a safe owner or active-member summary without group internals', async () => {
    await expect(repository.getAccessibleGroupSummary(ownerId, ownerGroupId)).resolves.toEqual({
      avatar: 'owner-avatar',
      groupId: ownerGroupId,
      joinedAt: null,
      kind: 'owner',
      membershipVersion: 0,
      ownerDisplayName: '旅游策划师',
      resourceOwnerUserId: ownerId,
      title: '群主的旅游群',
    });
    await expect(repository.getAccessibleGroupSummary(memberId, ownerGroupId)).resolves.toEqual({
      avatar: 'owner-avatar',
      groupId: ownerGroupId,
      joinedAt,
      kind: 'member',
      membershipVersion: 5,
      ownerDisplayName: '旅游策划师',
      resourceOwnerUserId: ownerId,
      title: '群主的旅游群',
    });
  });

  it.each([
    ['missing group', outsiderId, 'missing-group'],
    ['outside account', outsiderId, ownerGroupId],
    ['removed member', removedMemberId, ownerGroupId],
    ['cross-group access', memberId, otherPrivateGroupId],
    ['public group owner', publicOwnerId, publicGroupId],
    ['non-default group owner', customOwnerId, customGroupId],
  ])('uses one unavailable error for %s', async (_label, actorUserId, groupId) => {
    await expect(repository.getAccessibleGroupSummary(actorUserId, groupId)).rejects.toMatchObject({
      code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      message: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      name: 'GroupConversationAccessUnavailableError',
    });
  });
});
