'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Alert, Button, Switch, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Bell, ChevronLeft, ChevronRight, Mail, Smartphone } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router';

import {
  type DeliveryChannel,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  type NotificationEventType,
} from '@/const/settings/notificationEvents';
import SkeletonBar from '@/components/Skeleton/Bar';
import { openInboxModal } from '@/features/HomeSidebar/Header/components/InboxModal';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { lambdaQuery } from '@/libs/trpc/client';

const channels = {
  inbox: { label: '站内通知', icon: Bell, description: '在应用内通知中心显示通知。' },
  email: { label: '邮件通知', icon: Mail, description: '重要事件发生时，发送到账号已验证的邮箱。' },
  sms: {
    label: '短信通知',
    icon: Smartphone,
    description: '重要事件发生时，发送到账号已验证的手机号。短信内容仅包含事件类型。',
  },
};
const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`
    width: 100%;
    min-width: 0;
    gap: 20px;
    font-size: 14px;
  `,
  panel: css`
    overflow: hidden;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    min-width: 0;
    padding: 20px;
    box-sizing: border-box;
    text-align: start;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 0;
    font: inherit;
    &:not(:last-child) {
      border-bottom: 0.5px solid ${cssVar.colorBorderSecondary};
    }
  `,
  link: css`
    cursor: pointer;

    @media (hover: hover) {
      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    }

    &:active {
      background: ${cssVar.colorFillTertiary};
    }
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  icon: css`
    display: grid;
    place-items: center;
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: 10px;
    background: ${cssVar.colorFillQuaternary};
  `,
  muted: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  `,
}));

export default function Notification() {
  const { sub } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const base = location.pathname.replace(/\/notification(?:\/.*)?$/, '/notification');
  const active = NOTIFICATION_CHANNELS.includes(sub as DeliveryChannel)
    ? (sub as DeliveryChannel)
    : undefined;
  const query = lambdaQuery.notification.getSettings.useQuery(undefined, { retry: false });
  const utils = lambdaQuery.useUtils();
  const mutation = lambdaQuery.notification.updateSetting.useMutation({
    onSuccess: (data) => utils.notification.getSettings.setData(undefined, data),
  });
  const change = async (
    channel: DeliveryChannel,
    enabled: boolean,
    type?: NotificationEventType,
  ) => {
    try {
      await mutation.mutateAsync({ channel, enabled, ...(type ? { type } : {}) });
      toast.success('通知设置已保存');
    } catch {
      toast.error('通知设置保存失败，请稍后重试');
    }
  };
  if (query.isLoading) return <SkeletonBar height={240} width="100%" />;
  if (query.isError || !query.data)
    return (
      <Flexbox gap={12}>
        <Alert message="通知设置加载失败" type="error" />
        <Button onClick={() => query.refetch()}>重新加载</Button>
      </Flexbox>
    );
  const { settings, channels: availability, deliveries } = query.data;
  const enabled = (channel: DeliveryChannel, type?: NotificationEventType) => {
    const event = NOTIFICATION_EVENTS.find((item) => item.type === type);
    return (
      settings[channel]?.enabled !== false &&
      (!event || settings[channel]?.items?.[event.category]?.[event.type] !== false)
    );
  };
  const detail = active ? channels[active] : undefined;
  return (
    <Flexbox className={styles.page}>
      <Flexbox horizontal justify="flex-end">
        <Button icon={Bell} onClick={() => openInboxModal()}>
          查看通知
        </Button>
      </Flexbox>
      {active && detail ? (
        <>
          <Flexbox horizontal align="center" gap={8}>
            <Button
              aria-label="返回通知设置"
              icon={ChevronLeft}
              type="text"
              onClick={() => navigate(base)}
            />
            <strong>{detail.label}</strong>
          </Flexbox>
          <div className={styles.muted}>{detail.description}这些设置适用于当前账号。</div>
          {!availability[active].available && (
            <Alert message={availability[active].reason} type="info" />
          )}
          <div className={styles.panel}>
            <div className={styles.row}>
              <strong>启用{detail.label}</strong>
              <Switch
                aria-label={`启用${detail.label}`}
                checked={enabled(active)}
                disabled={
                  mutation.isPending || (!availability[active].available && !enabled(active))
                }
                onChange={(value) => change(active, value)}
              />
            </div>
          </div>
          <strong>通知类型</strong>
          <div className={styles.panel}>
            {NOTIFICATION_EVENTS.map((event) => (
              <div className={styles.row} key={event.type}>
                <span>{event.title}</span>
                <Switch
                  aria-label={event.title}
                  checked={enabled(active, event.type)}
                  disabled={
                    !enabled(active) || !availability[active].available || mutation.isPending
                  }
                  onChange={(value) => change(active, value, event.type)}
                />
              </div>
            ))}
          </div>
          {active !== 'inbox' && (
            <div className={styles.muted}>
              通知发送失败不会影响任务结果；你仍可在站内通知中心查看已开启的通知。
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.panel}>
            {NOTIFICATION_CHANNELS.map((channel) => {
              const item = channels[channel];
              const count = NOTIFICATION_EVENTS.filter((event) =>
                enabled(channel, event.type),
              ).length;
              return (
                <button
                  className={`${styles.row} ${styles.link}`}
                  key={channel}
                  type="button"
                  onClick={() => navigate(`${base}/${channel}`)}
                >
                  <Flexbox horizontal align="center" gap={14}>
                    <span className={styles.icon}>
                      <Icon icon={item.icon} size={22} />
                    </span>
                    <Flexbox gap={4}>
                      <SettingsSearchAnchor id={`notification-${channel}`}>
                        <strong>{item.label}</strong>
                      </SettingsSearchAnchor>
                      <span className={styles.muted}>
                        {!availability[channel].available
                          ? availability[channel].reason
                          : enabled(channel)
                            ? `已开启 ${count} 类通知`
                            : '未开启'}
                      </span>
                    </Flexbox>
                  </Flexbox>
                  <Icon icon={ChevronRight} size={16} />
                </button>
              );
            })}
          </div>
          <div className={styles.muted}>
            站内通知默认开启；邮件和短信由你自行开启。通知来自实际生成和任务事件，不会补发历史消息。
          </div>
          {deliveries.length > 0 && (
            <Flexbox gap={8}>
              <strong>最近发送记录</strong>
              <div className={styles.panel}>
                {deliveries.map((delivery, index) => (
                  <div className={styles.row} key={index}>
                    <span>
                      {delivery.channel === 'sms' ? '短信' : '邮件'} ·{' '}
                      {delivery.status === 'sent' || delivery.status === 'delivered'
                        ? '已发送'
                        : delivery.status === 'pending'
                          ? '发送中'
                          : '发送失败'}
                    </span>
                    <span className={styles.muted}>
                      {new Date(delivery.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                ))}
              </div>
            </Flexbox>
          )}
        </>
      )}
    </Flexbox>
  );
}
