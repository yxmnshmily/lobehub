import type { NotificationMetadata, NotificationSettings } from '@lobechat/types';
import { mergeNotificationSettings } from '@lobechat/utils/mergeNotificationSettings';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  type DeliveryChannel,
  NOTIFICATION_EVENTS,
  type NotificationEventType,
} from '@/const/settings/notificationEvents';
import { getServerDB } from '@/database/core/db-adaptor';
import { NotificationModel } from '@/database/models/notification';
import { UserModel } from '@/database/models/user';
import { WorkspaceUserSettingsModel } from '@/database/models/workspaceUserSettings';
import { notificationDeliveries, notifications } from '@/database/schemas/notification';
import { users, userSettings } from '@/database/schemas/user';
import type { LobeChatDatabase } from '@/database/type';

import { channelAvailability, sendNotificationChannel } from './channels';

export interface NotificationEvent {
  actionUrl?: string;
  content: string;
  eventId: string;
  metadata?: NotificationMetadata;
  type: NotificationEventType;
}
export interface NotificationSettingChange {
  channel: DeliveryChannel;
  enabled: boolean;
  type?: NotificationEventType;
}

const defaults: NotificationSettings = {
  inbox: { enabled: true },
  email: { enabled: false },
  sms: { enabled: false },
};
const normalize = (settings: unknown) =>
  mergeNotificationSettings(defaults, (settings ?? {}) as NotificationSettings);
const isEnabled = (
  settings: NotificationSettings,
  channel: DeliveryChannel,
  category: string,
  type: string,
) => settings[channel]?.enabled !== false && settings[channel]?.items?.[category]?.[type] !== false;

export class NotificationService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
    private workspaceId?: string,
  ) {}

  /** Preferences belong to the signed-in person; destinations come only from verified account data. */
  async getSettings() {
    const [user, stored] = await Promise.all([
      UserModel.findById(this.db, this.userId),
      new UserModel(this.db, this.userId).getUserSettings(),
    ]);
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const configured = channelAvailability();
    const emailVerified = Boolean(user.email && user.emailVerified);
    const phoneVerified = Boolean(user.phone && user.phoneNumberVerified);
    const deliveries = await this.db
      .select({
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        createdAt: notificationDeliveries.createdAt,
      })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(
        and(
          eq(notifications.userId, this.userId),
          inArray(notificationDeliveries.channel, ['email', 'sms']),
        ),
      )
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(10);
    return {
      settings: normalize(stored?.notification),
      channels: {
        inbox: { available: true, reason: '' },
        email: {
          available: configured.email && emailVerified,
          reason: !configured.email
            ? '邮件服务尚未配置'
            : !emailVerified
              ? '请先在账号设置中验证邮箱'
              : '',
        },
        sms: {
          available: configured.sms && phoneVerified,
          reason: !configured.sms
            ? '短信通知模板尚未配置'
            : !phoneVerified
              ? '请先在账号设置中绑定并验证手机号'
              : '',
        },
      },
      deliveries,
    };
  }

  async updateSetting(input: NotificationSettingChange) {
    const state = await this.getSettings();
    if (input.enabled && !state.channels[input.channel].available)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: state.channels[input.channel].reason,
      });
    const scenario = NOTIFICATION_EVENTS.find((item) => item.type === input.type);
    const patch: NotificationSettings = {
      [input.channel]: scenario
        ? { items: { [scenario.category]: { [scenario.type]: input.enabled } } }
        : { enabled: input.enabled },
    };
    // Serialize updates from multiple tabs, including the first write when no settings row exists.
    await this.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, this.userId)).for('update');
      const [stored] = await tx
        .select({ notification: userSettings.notification })
        .from(userSettings)
        .where(eq(userSettings.id, this.userId));
      const notification = mergeNotificationSettings(
        (stored?.notification ?? {}) as NotificationSettings,
        patch,
      );
      await tx
        .insert(userSettings)
        .values({ id: this.userId, notification })
        .onConflictDoUpdate({ target: userSettings.id, set: { notification } });
    });
    return this.getSettings();
  }

  async notify(event: NotificationEvent) {
    const scenario = NOTIFICATION_EVENTS.find((item) => item.type === event.type);
    if (!scenario) return;
    const [user, stored, workspace] = await Promise.all([
      UserModel.findById(this.db, this.userId),
      new UserModel(this.db, this.userId).getUserSettings(),
      this.workspaceId
        ? new WorkspaceUserSettingsModel(this.db, this.userId, this.workspaceId).getPreference()
        : undefined,
    ]);
    if (!user) return;
    const settings = normalize(stored?.notification);
    const enabled = (channel: DeliveryChannel) =>
      isEnabled(settings, channel, scenario.category, scenario.type) &&
      isEnabled(workspace?.notification ?? {}, channel, scenario.category, scenario.type);
    const model = new NotificationModel(this.db, this.userId);
    const actionUrl =
      event.actionUrl?.startsWith('/') &&
      !/^\/[/\\]/.test(event.actionUrl) &&
      !/[\r\n]/.test(event.actionUrl)
        ? event.actionUrl
        : null;
    // Keep a dedupe record even when the inbox is disabled, preventing repeat external sends.
    const row = await model.create({
      workspaceId: this.workspaceId ?? null,
      category: scenario.category,
      type: event.type,
      title: scenario.title,
      content: event.content.slice(0, 1000),
      metadata: event.metadata,
      actionUrl,
      dedupeKey: `${this.workspaceId ?? 'personal'}:${event.type}:${event.eventId}`,
      isArchived: !enabled('inbox'),
    });
    if (!row) return;
    const configured = channelAvailability();
    for (const channel of ['email', 'sms'] as const) {
      if (!enabled(channel)) continue;
      const to =
        channel === 'email'
          ? user.emailVerified
            ? user.email
            : null
          : user.phoneNumberVerified
            ? user.phone
            : null;
      let status: 'sent' | 'failed' = 'failed';
      let failedReason: string | null = 'CHANNEL_UNAVAILABLE';
      let providerMessageId: string | undefined;
      if (configured[channel] && to) {
        try {
          // External channels contain a generic event summary, never prompts, generated text or private links.
          const result = await sendNotificationChannel(channel, { to, title: scenario.title });
          status = 'sent';
          failedReason = null;
          providerMessageId = result.messageId;
        } catch {
          failedReason = 'DELIVERY_FAILED';
        }
      }
      await model.createDelivery({
        notificationId: row.id,
        channel,
        status,
        failedReason,
        providerMessageId,
        sentAt: status === 'sent' ? new Date() : null,
      });
    }
  }
}

export async function notifyUser(
  params: NotificationEvent & { userId: string; workspaceId?: string },
) {
  try {
    await new NotificationService(await getServerDB(), params.userId, params.workspaceId).notify(
      params,
    );
  } catch {
    // A notification failure must not turn a completed generation/task into a failed one.
    console.error('[notification] event delivery failed');
  }
}
