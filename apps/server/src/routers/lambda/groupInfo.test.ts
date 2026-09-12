// @vitest-environment node
import {
  chatGroups,
  chatGroupUserMemberships,
  users,
  userSettings,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@/server/services/user/travelServiceGroup';

import { groupInfoRouter } from './groupInfo';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn(({ ctx, next }) => next({ ctx })),
}));
const db = await getTestDB();
const ids = ['group-info-owner', 'group-info-member', 'group-info-stranger'];
const groupId = 'group-info-test';
const caller = (userId: string, workspaceId?: string) =>
  groupInfoRouter.createCaller({ serverDB: db, userId, workspaceId } as never);
const cleanup = async () => {
  await db.delete(chatGroups).where(eq(chatGroups.id, groupId));
  await db.delete(users).where(inArray(users.id, ids));
};

beforeAll(async () => {
  // Membership migrations are not yet in the test database migration journal.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS chat_group_user_memberships (
    chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by_user_id text, role text NOT NULL DEFAULT 'member',
    can_use_paid_ai boolean NOT NULL DEFAULT false,
    max_credits_per_request bigint, max_credits_per_period bigint,
    membership_version integer NOT NULL DEFAULT 1,
    joined_at timestamptz NOT NULL DEFAULT now(), removed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(chat_group_id, user_id))`);
});
beforeEach(async () => {
  await cleanup();
  await db.insert(users).values(ids.map((id) => ({ id, username: id })));
  await db.insert(chatGroups).values({
    id: groupId,
    userId: ids[0],
    title: '测试群',
    visibility: 'private',
    clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
    config: { systemPrompt: 'private owner prompt' },
  });
  await db.insert(chatGroupUserMemberships).values({ chatGroupId: groupId, userId: ids[1] });
});
afterAll(cleanup);

it('lets only the owner publish an announcement visible to members without exposing config', async () => {
  await caller(ids[0]).updateAnnouncement({ groupId, announcement: '欢迎入群' });
  expect(await caller(ids[1]).get({ groupId })).toMatchObject({
    announcement: '欢迎入群',
    canEditAnnouncement: false,
  });
  expect(await caller(ids[0]).get({ groupId })).not.toHaveProperty('config');
  await expect(
    caller(ids[1]).updateAnnouncement({ groupId, announcement: 'tamper' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const [group] = await db.select().from(chatGroups).where(eq(chatGroups.id, groupId));
  expect(group.config?.systemPrompt).toBe('private owner prompt');
});

it('isolates private remarks by current user and preserves unrelated preferences', async () => {
  await db.insert(userSettings).values({ id: ids[1], general: { language: 'en-US' } });
  await caller(ids[1]).updateRemark({ groupId, remark: '我的私人备注' });
  await caller(ids[0]).updateRemark({ groupId, remark: '群主自己的备注' });
  expect((await caller(ids[1]).get({ groupId })).remark).toBe('我的私人备注');
  expect((await caller(ids[0]).get({ groupId })).remark).toBe('群主自己的备注');
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.id, ids[1]));
  expect(settings.general).toMatchObject({ language: 'en-US' });
  await caller(ids[1]).updateRemark({ groupId, remark: '' });
  expect((await caller(ids[1]).get({ groupId })).remark).toBe('');
});

it('rejects outsiders, removed members, deleted groups and workspace callers', async () => {
  await expect(caller(ids[2]).get({ groupId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(caller(ids[0], 'workspace').get({ groupId })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await db
    .update(chatGroupUserMemberships)
    .set({ removedAt: new Date() })
    .where(eq(chatGroupUserMemberships.chatGroupId, groupId));
  await expect(caller(ids[1]).updateRemark({ groupId, remark: 'x' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await db.update(chatGroups).set({ deletedAt: new Date() }).where(eq(chatGroups.id, groupId));
  await expect(caller(ids[0]).get({ groupId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
});

it('uses a read-only nickname with username fallback and rejects oversized input', async () => {
  await db.update(users).set({ fullName: '  昵称  ' }).where(eq(users.id, ids[1]));
  expect((await caller(ids[1]).get({ groupId })).nickname).toBe('昵称');
  await db.update(users).set({ fullName: '  ' }).where(eq(users.id, ids[1]));
  expect((await caller(ids[1]).get({ groupId })).nickname).toBe(ids[1]);
  await expect(
    caller(ids[0]).updateAnnouncement({ groupId, announcement: 'a'.repeat(4001) }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('preserves remarks when another tab saves or resets general settings', async () => {
  await caller(ids[1]).updateRemark({ groupId, remark: '保留的备注' });
  const user = new UserModel(db, ids[1]);
  await user.updateSetting({
    general: { language: 'en-US', groupRemarks: { [groupId]: 'stale' } },
  });
  expect((await caller(ids[1]).get({ groupId })).remark).toBe('保留的备注');
  await user.updateSetting({ general: null });
  expect((await caller(ids[1]).get({ groupId })).remark).toBe('保留的备注');
  const withoutRemarks = new UserModel(db, ids[0]);
  await withoutRemarks.updateSetting({ general: { language: 'zh-CN' } });
  await withoutRemarks.updateSetting({ general: null });
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.id, ids[0]));
  expect(settings.general).toBeNull();
});
