// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { chatGroups, chatGroupUserMemberships, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import {
  GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
  resolveGroupConversationPrincipal,
} from './principal';

const db: LobeChatDatabase = await getTestDB();

const ownerId = 'group-principal-owner';
const memberId = 'group-principal-member';
const removedMemberId = 'group-principal-removed';
const outsiderId = 'group-principal-outsider';
const publicOwnerId = 'group-principal-public-owner';
const customOwnerId = 'group-principal-custom-owner';
const userIds = [ownerId, memberId, removedMemberId, outsiderId, publicOwnerId, customOwnerId];

const privateDefaultGroupId = 'group-principal-private-default';
const publicDefaultGroupId = 'group-principal-public-default';
const privateCustomGroupId = 'group-principal-private-custom';
const groupIds = [privateDefaultGroupId, publicDefaultGroupId, privateCustomGroupId];
const memberJoinedAt = new Date('2026-09-04T00:00:00.000Z');

const cleanup = async () => {
  await db
    .delete(chatGroupUserMemberships)
    .where(inArray(chatGroupUserMemberships.chatGroupId, groupIds));
  await db.delete(chatGroups).where(inArray(chatGroups.id, groupIds));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeAll(async () => {
  // Membership migration is intentionally deferred; create only this isolated test contract table.
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
  await db.insert(chatGroups).values([
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: privateDefaultGroupId,
      title: '私人旅游群',
      userId: ownerId,
      visibility: 'private',
    },
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: publicDefaultGroupId,
      title: '公开旅游群',
      userId: publicOwnerId,
      visibility: 'public',
    },
    {
      clientId: 'custom-group',
      id: privateCustomGroupId,
      title: '私人自定义群',
      userId: customOwnerId,
      visibility: 'private',
    },
  ]);
  await db.insert(chatGroupUserMemberships).values([
    {
      chatGroupId: privateDefaultGroupId,
      invitedByUserId: ownerId,
      joinedAt: memberJoinedAt,
      membershipVersion: 3,
      userId: memberId,
    },
    {
      chatGroupId: privateDefaultGroupId,
      invitedByUserId: ownerId,
      membershipVersion: 4,
      removedAt: new Date('2026-09-04T01:00:00.000Z'),
      userId: removedMemberId,
    },
  ]);
});

afterAll(cleanup);

describe('resolveGroupConversationPrincipal', () => {
  it('returns the private default group owner without membership state or group configuration', async () => {
    await expect(
      resolveGroupConversationPrincipal(db, {
        actorUserId: ownerId,
        groupId: privateDefaultGroupId,
      }),
    ).resolves.toEqual({
      actorUserId: ownerId,
      groupId: privateDefaultGroupId,
      joinedAt: null,
      kind: 'owner',
      membershipVersion: 0,
      resourceOwnerUserId: ownerId,
    });
  });

  it('returns an active member with the real actor, group owner, and membership version', async () => {
    await expect(
      resolveGroupConversationPrincipal(db, {
        actorUserId: memberId,
        groupId: privateDefaultGroupId,
      }),
    ).resolves.toEqual({
      actorUserId: memberId,
      groupId: privateDefaultGroupId,
      joinedAt: memberJoinedAt,
      kind: 'member',
      membershipVersion: 3,
      resourceOwnerUserId: ownerId,
    });
  });

  it.each([
    ['missing group', outsiderId, 'missing-group'],
    ['outside account', outsiderId, privateDefaultGroupId],
    ['removed member', removedMemberId, privateDefaultGroupId],
    ['public group owner', publicOwnerId, publicDefaultGroupId],
    ['non-default group owner', customOwnerId, privateCustomGroupId],
  ])('returns one indistinguishable error for %s', async (_label, actorUserId, groupId) => {
    await expect(
      resolveGroupConversationPrincipal(db, { actorUserId, groupId }),
    ).rejects.toMatchObject({
      code: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      message: GROUP_CONVERSATION_ACCESS_UNAVAILABLE,
      name: 'GroupConversationAccessUnavailableError',
    });
  });
});
