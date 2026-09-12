// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { users } from '@/database/schemas/user';

import { notificationRouter } from '../notification';

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));
vi.mock('@/server/services/notification/channels', () => ({
  channelAvailability: () => ({ email: false, sms: false }),
  sendNotificationChannel: vi.fn(),
}));
const db = await getTestDB();
const userId = 'notification-settings-api-user';
const other = 'notification-settings-api-other';
const caller = (id?: string) =>
  notificationRouter.createCaller({ serverDB: db, userId: id } as any);
beforeAll(async () => {
  await db.insert(users).values([{ id: userId }, { id: other }]);
});
describe('notification settings boundary', () => {
  it('requires authentication for both reading and writing preferences', async () => {
    await expect(caller().getSettings()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(
      caller().updateSetting({ channel: 'inbox', enabled: false }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('only changes the current user and rejects injected recipient fields', async () => {
    await caller(userId).updateSetting({ channel: 'inbox', enabled: false });
    expect((await caller(userId).getSettings()).settings.inbox?.enabled).toBe(false);
    expect((await caller(other).getSettings()).settings.inbox?.enabled).toBe(true);
    await expect(
      caller(userId).updateSetting({ channel: 'inbox', enabled: true, userId: other } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('rejects unknown notification types and unavailable external channels', async () => {
    await expect(
      caller(userId).updateSetting({ channel: 'inbox', type: 'invented', enabled: true } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller(userId).updateSetting({ channel: 'sms', enabled: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
