'use client';

import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Alert, Button, confirmModal, Tag, Text } from '@lobehub/ui/base-ui';
import { Empty } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Clock3Icon, LogOutIcon, MonitorSmartphoneIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import SkeletonText from '@/components/Skeleton/Text';
import { lambdaClient } from '@/libs/trpc/client';
import { translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

interface SafeLoginSession {
  browserName: string;
  createdAt: Date;
  current: boolean;
  deviceName: string;
  expiresAt: Date;
  maskedIp: string | null;
  sessionId: string;
  updatedAt: Date;
}

interface LoginSessionsProps {
  locale: string;
}

const styles = createStaticStyles(({ css }) => ({
  deviceHeader: css`
    min-width: 0;

    @media (width <= 480px) {
      flex-wrap: wrap;
    }
  `,
  deviceInfo: css`
    min-width: 0;

    @media (width <= 480px) {
      width: 100%;
    }
  `,
  revokeButton: css`
    @media (width <= 480px) {
      width: 100%;
    }
  `,
  row: css`
    padding: 16px;

    @media (width <= 480px) {
      flex-direction: column;
      gap: 12px;
      align-items: stretch !important;
    }
  `,
  sessionList: css`
    overflow: hidden;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    & > * + * {
      border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
    }
  `,
}));

const SESSION_BATCH_SIZE = 10;

const formatSessionTime = (value: Date, locale: string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return translateTravel('时间未知');

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const LoginSessions = ({ locale }: LoginSessionsProps) => {
  const translateTravel = useTravelTranslation();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string>();
  const [sessions, setSessions] = useState<SafeLoginSession[]>([]);
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_BATCH_SIZE);
  const latestRequest = useRef(0);
  const revokeInFlight = useRef(false);

  const loadSessions = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setError(undefined);
    setIsLoading(true);

    try {
      const nextSessions = await lambdaClient.userSessionManagement.listSessions.query();
      if (requestId !== latestRequest.current) return;
      setSessions(nextSessions);
      setVisibleSessionCount(SESSION_BATCH_SIZE);
    } catch {
      if (requestId !== latestRequest.current) return;
      setError(translateTravel('登录设备暂时无法读取'));
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [translateTravel]);

  useEffect(() => {
    void loadSessions();
    return () => {
      latestRequest.current += 1;
    };
  }, [loadSessions]);

  const revokeSession = (session: SafeLoginSession) => {
    if (session.current) return;

    confirmModal({
      cancelText: translateTravel('取消'),
      content: (
        <Flexbox gap={8}>
          <Text as="h3" weight={600}>
            {translateTravel('退出此设备？')}
          </Text>
          <Text>{translateTravel('该设备将需要重新登录。当前设备不受影响。')}</Text>
        </Flexbox>
      ),
      okButtonProps: { danger: true },
      okText: translateTravel('退出设备'),
      onOk: async () => {
        if (revokeInFlight.current) return;
        revokeInFlight.current = true;
        setError(undefined);
        setRevokingId(session.sessionId);
        try {
          await lambdaClient.userSessionManagement.revokeSession.mutate({
            sessionId: session.sessionId,
          });
          setSessions((current) =>
            current.filter(({ sessionId }) => sessionId !== session.sessionId),
          );
        } catch {
          setError(translateTravel('无法退出该设备，请重试'));
          throw new Error(translateTravel('设备会话退出失败，请重试'));
        } finally {
          revokeInFlight.current = false;
          setRevokingId(undefined);
        }
      },
      title: false,
    });
  };

  return (
    <Flexbox aria-labelledby="login-sessions-title" gap={12} role="region">
      <Flexbox gap={4}>
        <Text as="h3" id="login-sessions-title" weight={600}>
          {translateTravel('登录设备')}
        </Text>
        <Text type="secondary">{translateTravel('只能查看和退出您自己的其他登录会话。')}</Text>
      </Flexbox>

      {isLoading ? (
        <Flexbox aria-live="polite" gap={8}>
          <Text type="secondary">{translateTravel('正在读取登录设备')}</Text>
          <SkeletonText rows={2} />
        </Flexbox>
      ) : error && sessions.length === 0 ? (
        <Alert
          showIcon
          action={<Button onClick={() => void loadSessions()}>{translateTravel('重试')}</Button>}
          title={error}
          type="error"
        />
      ) : sessions.length === 0 ? (
        <Empty description={translateTravel('暂无登录设备')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          {error && (
            <Alert
              showIcon
              action={
                <Button onClick={() => void loadSessions()}>{translateTravel('重试')}</Button>
              }
              title={error}
              type="error"
            />
          )}
          <div className={styles.sessionList}>
            {sessions.slice(0, visibleSessionCount).map((session) => (
              <Flexbox
                horizontal
                align="center"
                className={styles.row}
                gap={16}
                justify="space-between"
                key={session.sessionId}
              >
                <Flexbox horizontal align="center" className={styles.deviceInfo} flex={1} gap={12}>
                  <Block padding={10} variant="filled">
                    <Icon icon={MonitorSmartphoneIcon} size={20} />
                  </Block>
                  <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" className={styles.deviceHeader} gap={8}>
                      <Text ellipsis weight={500}>
                        {session.browserName} · {session.deviceName}
                      </Text>
                      {session.current && <Tag>{translateTravel('当前会话')}</Tag>}
                    </Flexbox>
                    <Flexbox horizontal align="center" gap={8} wrap="wrap">
                      <Text type="secondary">{session.maskedIp ?? translateTravel('IP 未知')}</Text>
                      <Text type="secondary">
                        <Icon icon={Clock3Icon} size={12} /> {translateTravel('最近活动：')}
                        {formatSessionTime(session.updatedAt, locale)}
                      </Text>
                    </Flexbox>
                  </Flexbox>
                </Flexbox>

                {!session.current && (
                  <Button
                    className={styles.revokeButton}
                    disabled={Boolean(revokingId)}
                    icon={<Icon icon={LogOutIcon} size={16} />}
                    loading={revokingId === session.sessionId}
                    onClick={() => revokeSession(session)}
                  >
                    {translateTravel('退出此设备')}
                  </Button>
                )}
              </Flexbox>
            ))}
          </div>
          {sessions.length > visibleSessionCount && (
            <Button
              block
              onClick={() => setVisibleSessionCount((count) => count + SESSION_BATCH_SIZE)}
            >
              {translateTravel('显示更多设备（剩余')}
              {sessions.length - visibleSessionCount}）
            </Button>
          )}
        </>
      )}
    </Flexbox>
  );
};

export default LoginSessions;
