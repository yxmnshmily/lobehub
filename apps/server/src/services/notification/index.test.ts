// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { NotificationModel } from '@/database/models/notification';
import { notificationDeliveries } from '@/database/schemas/notification';
import { users, userSettings } from '@/database/schemas/user';
import { workspaces } from '@/database/schemas/workspace';

import { NotificationService } from './index';

const send = vi.hoisted(() =>
  vi.fn(async (_channel: string, _payload: { to: string; title: string }) => ({
    messageId: 'provider-message',
  })),
);
vi.mock('./channels', () => ({
  channelAvailability: () => ({ email: true, sms: true }),
  sendNotificationChannel: send,
}));
const db = await getTestDB();
const uid = 'notification-service-owner';
const other = 'notification-service-other';
const ws = 'notification-service-workspace';
const event = {
  type: 'image_generation_completed' as const,
  eventId: 'batch-1',
  content: '图片已生成',
  actionUrl: '/image',
};
const service = () => new NotificationService(db, uid);

beforeAll(async () => {
  await db
    .insert(users)
    .values([{ id: uid, email: 'owner@example.com', emailVerified: true }, { id: other }]);
  await db
    .insert(workspaces)
    .values({ id: ws, name: 'test', slug: 'notification-test', primaryOwnerId: uid });
});
beforeEach(() => send.mockClear());
afterEach(async () => {
  await db.delete(notificationDeliveries);
  const { notifications } = await import('@/database/schemas/notification');
  await db.delete(notifications);
  await db.delete(userSettings).where(eq(userSettings.id, uid));
});

describe('NotificationService', () => {
  it('persists real events for the owner once and defaults external delivery off', async () => {
    await Promise.all([service().notify(event), service().notify(event)]);
    expect(await new NotificationModel(db, uid).getUnreadCount()).toBe(1);
    expect(await new NotificationModel(db, other).getUnreadCount()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps workspace events out of the personal inbox', async () => {
    await new NotificationService(db, uid, ws).notify(event);
    expect(await new NotificationModel(db, uid, { workspaceId: null }).getUnreadCount()).toBe(0);
    expect(await new NotificationModel(db, uid, { workspaceId: ws }).getUnreadCount()).toBe(1);
  });
  it('persists individual switches without wiping sibling categories or channels', async () => {
    await service().updateSetting({ channel: 'email', enabled: true });
    await service().updateSetting({
      channel: 'inbox',
      type: 'image_generation_completed',
      enabled: false,
    });
    await service().updateSetting({
      channel: 'inbox',
      type: 'agent_cron_job_failed',
      enabled: false,
    });
    const settings = (await service().getSettings()).settings;
    expect(settings.email?.enabled).toBe(true);
    expect(settings.inbox?.items?.generation?.image_generation_completed).toBe(false);
    expect(settings.inbox?.items?.schedule?.agent_cron_job_failed).toBe(false);
  });
  it('honors inbox opt-out while recording a single successful email delivery', async () => {
    await service().updateSetting({ channel: 'inbox', enabled: false });
    await service().updateSetting({ channel: 'email', enabled: true });
    await service().notify(event);
    await service().notify(event);
    expect(await new NotificationModel(db, uid).getUnreadCount()).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual(
      expect.arrayContaining(['email', expect.objectContaining({ to: 'owner@example.com' })]),
    );
    expect(await db.select().from(notificationDeliveries)).toEqual([
      expect.objectContaining({ channel: 'email', status: 'sent' }),
    ]);
  });
  it('keeps the inbox event when outbound delivery fails and records a safe failure reason', async () => {
    await service().updateSetting({ channel: 'email', enabled: true });
    send.mockRejectedValueOnce(new Error('secret provider credentials'));
    await service().notify(event);
    expect(await new NotificationModel(db, uid).getUnreadCount()).toBe(1);
    const rows = await db.select().from(notificationDeliveries);
    expect(rows[0]).toMatchObject({ status: 'failed', failedReason: 'DELIVERY_FAILED' });
  });
  it('rejects unverified SMS recipients instead of enabling a non-working switch', async () => {
    await expect(service().updateSetting({ channel: 'sms', enabled: true })).rejects.toThrow();
    expect((await service().getSettings()).settings.sms?.enabled).toBe(false);
  });
  it('keeps simultaneous switch updates from overwriting each other', async () => {
    await Promise.all([
      service().updateSetting({
        channel: 'inbox',
        type: 'image_generation_completed',
        enabled: false,
      }),
      service().updateSetting({
        channel: 'inbox',
        type: 'video_generation_completed',
        enabled: false,
      }),
    ]);
    const settings = (await service().getSettings()).settings;
    expect(settings.inbox?.items?.generation).toEqual({
      image_generation_completed: false,
      video_generation_completed: false,
    });
  });
  it('never stores external or protocol-relative action URLs', async () => {
    await service().notify({ ...event, actionUrl: '//evil.example' });
    expect((await new NotificationModel(db, uid).list())[0].actionUrl).toBeNull();
  });
});

it.each(['credits_exhausted', 'credits_top_up_completed'] as const)(
  'persists %s once under billing and honors its channel switch',
  async (type) => {
    await service().updateSetting({ channel: 'email', enabled: true });
    await service().updateSetting({ channel: 'email', enabled: false, type });
    const billingEvent = {
      type,
      eventId: 'ledger-1',
      content: '账务变动',
      actionUrl: '/settings/credits',
    };
    await service().notify(billingEvent);
    await service().notify(billingEvent);
    expect(await new NotificationModel(db, uid).getUnreadCount()).toBe(1);
    expect(send).not.toHaveBeenCalled();
    const settings = (await service().getSettings()).settings;
    expect(settings.email?.items?.billing?.[type]).toBe(false);
  },
);

it('delivers both billing scenarios through enabled email and SMS only once', async () => {
  await db
    .update(users)
    .set({ phone: '13800138000', phoneNumberVerified: true })
    .where(eq(users.id, uid));
  try {
    await service().updateSetting({ channel: 'email', enabled: true });
    await service().updateSetting({ channel: 'sms', enabled: true });
    for (const type of ['credits_exhausted', 'credits_top_up_completed'] as const) {
      const event = { type, eventId: type, content: '账务变动' };
      await service().notify(event);
      await service().notify(event);
    }
    expect(await new NotificationModel(db, uid).getUnreadCount()).toBe(2);
    expect(send.mock.calls.map(([channel]) => channel)).toEqual(['email', 'sms', 'email', 'sms']);
    expect(send).toHaveBeenCalledWith(
      'sms',
      expect.objectContaining({ to: '13800138000', title: '充值到账' }),
    );
  } finally {
    await db
      .update(users)
      .set({ phone: null, phoneNumberVerified: false })
      .where(eq(users.id, uid));
  }
});

it('persists pending transfer metadata and category counts without cross-account leakage', async () => {
  const scoped = new NotificationService(db, uid, ws);
  const transfer = {
    type: 'resource_transfer_requested' as const,
    eventId: 'transfer-1',
    content: '待确认',
    metadata: { transfer: { requestId: 'transfer-1' } },
  };
  await scoped.notify(transfer);
  await scoped.notify(transfer);
  const model = new NotificationModel(db, uid, { workspaceId: ws });
  expect(await model.countLinkedToTransfers(['transfer-1'])).toEqual({ total: 1, unread: 1 });
  expect((await model.list())[0]).toMatchObject({
    category: 'pending',
    metadata: transfer.metadata,
  });
  expect(await new NotificationModel(db, other, { workspaceId: ws }).getUnreadCount()).toBe(0);
  expect(await new NotificationModel(db, uid, { workspaceId: null }).getUnreadCount()).toBe(0);
});

it.each([
  'task_run_completed',
  'task_run_failed',
  'task_commented',
  'task_mentioned',
  'comment_removed',
  'agent_intervention_required',
  'video_generation_failed',
] as const)('honors the new %s scenario opt-out', async (type) => {
  await service().updateSetting({ channel: 'inbox', type, enabled: false });
  await service().notify({ type, eventId: 'revision', content: '新事件' });
  expect(await new NotificationModel(db, uid).getUnreadCount()).toBe(0);
});
