'use client';

import { DEFAULT_USER_AVATAR_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Alert, Avatar, Button, confirmModal, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Inbox, UsersRound } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import SkeletonBar from '@/components/Skeleton/Bar';
import { lambdaQuery } from '@/libs/trpc/client';
import { getTravelLocale, translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

interface GroupInvitationsProps {
  locale: string;
}

type Feedback = { message: string; type: 'error' | 'success' };

const styles = createStaticStyles(({ css, responsive }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
    padding: 20px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    background: ${cssVar.colorBgContainer};
    ${responsive.sm} {
      padding: 16px;
    }
  `,
  empty: css`
    margin: 0;
    padding: 16px;
    border-radius: 8px;
    background: ${cssVar.colorFillQuaternary};
    color: ${cssVar.colorTextSecondary};
    font-size: 14px;
    line-height: 1.6;
  `,
  action: css`
    flex: none;
  `,
  actions: css`
    flex: none;
    flex-wrap: wrap;
    button {
      min-height: 36px;
    }
  `,
  chatLink: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-height: 36px;
    padding-inline: 12px;
    border: 0.5px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};
    text-decoration: none;
    white-space: nowrap;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  list: css`
    overflow: hidden;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  meta: css`
    flex-wrap: wrap;
  `,
  row: css`
    min-width: 0;
    padding: 12px;

    ${responsive.sm} {
      flex-direction: column;
      align-items: flex-start;
    }
  `,
  rowContent: css`
    min-width: 0;
    overflow-wrap: anywhere;
  `,
  sectionTitle: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 12px;
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
    svg {
      flex-shrink: 0;
    }
  `,
}));

const formatDateTime = (value: Date, locale: string) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return translateTravel('时间未知');

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat(getTravelLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  }
};

const resolveTitle = (title: string | null) => title?.trim() || translateTravel('未命名群组');

const isConflictError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  if ('data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'code' in data && data.code === 'CONFLICT') {
      return true;
    }
  }
  return 'code' in error && error.code === 'CONFLICT';
};

const GroupInvitations = ({ locale }: GroupInvitationsProps) => {
  const translateTravel = useTravelTranslation();
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const actionInFlight = useRef(false);

  const invitationsQuery = lambdaQuery.groupMembership.listMyPendingInvitations.useQuery(
    undefined,
    { retry: false },
  );
  const groupsQuery = lambdaQuery.groupConversation.listGroups.useQuery(undefined, {
    gcTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const acceptInvitation = lambdaQuery.groupMembership.acceptMyInvitation.useMutation();
  const leaveGroup = lambdaQuery.groupMembership.leaveGroup.useMutation();

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    refresh: () => Promise<unknown>,
    successMessage: string,
    conflictMessage = translateTravel('邀请中的代付设置已变更，请群主重新邀请。'),
  ) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction(key);
    setFeedback(undefined);

    try {
      await action();
      await refresh();
      setFeedback({ message: successMessage, type: 'success' });
    } catch (error) {
      setFeedback({
        message:
          key.startsWith('accept:') && isConflictError(error)
            ? conflictMessage
            : translateTravel('操作未完成，请重试。'),
        type: 'error',
      });
    } finally {
      actionInFlight.current = false;
      setBusyAction(undefined);
    }
  };

  const handleAccept = async (invitationId: string, automaticOwnerBilling: boolean) => {
    await runAction(
      `accept:${invitationId}`,
      () => acceptInvitation.mutateAsync({ invitationId }),
      () => Promise.all([invitationsQuery.refetch(), groupsQuery.refetch()]),
      translateTravel('已接受群组邀请。'),
      automaticOwnerBilling
        ? translateTravel('邀请状态已变更，请刷新后重试或联系群主重新邀请。')
        : undefined,
    );
  };

  const confirmLeave = (group: {
    groupId: string;
    kind: 'member' | 'owner';
    membershipVersion: number;
    ownerDisplayName?: string | null;
    title: string | null;
  }) => {
    if (group.kind !== 'member' || actionInFlight.current) return;
    const title = group.ownerDisplayName
      ? translateTravel('{{v0}}用户的群组', { v0: group.ownerDisplayName })
      : resolveTitle(group.title);

    confirmModal({
      content: translateTravel(
        '退出后将清除你在该群的会话入口和历史记录，并停止访问。群主及其他成员的记录，以及你自己的超级群不受影响。',
      ),
      okButtonProps: { danger: true },
      okText: translateTravel('退出群组'),
      onOk: async () => {
        await runAction(
          `leave:${group.groupId}`,
          () =>
            leaveGroup.mutateAsync({
              expectedMembershipVersion: group.membershipVersion,
              groupId: group.groupId,
            }),
          () => groupsQuery.refetch(),
          translateTravel('已退出{{v0}}。', { v0: title }),
        );
      },
      title: translateTravel('退出{{v0}}？', { v0: title }),
    });
  };

  const invitations = invitationsQuery.data?.items ?? [];
  const groups = groupsQuery.data ?? [];

  return (
    <div aria-label={translateTravel('群组邀请与协作')} className={styles.container}>
      {feedback && <Alert showIcon title={feedback.message} type={feedback.type} />}

      <section aria-labelledby="pending-group-invitations">
        <h2 className={styles.sectionTitle} id="pending-group-invitations">
          <Inbox aria-hidden size={18} />
          {translateTravel('待接受邀请')}
          {invitationsQuery.data && <Tag>{invitations.length}</Tag>}
        </h2>
        {invitationsQuery.isLoading ? (
          <SkeletonBar height={80} />
        ) : invitationsQuery.isError ? (
          <Alert
            showIcon
            action={
              <Button onClick={() => void invitationsQuery.refetch()}>
                {translateTravel('重试')}
              </Button>
            }
            title={translateTravel('群组邀请暂时无法读取。')}
            type="error"
          />
        ) : invitations.length === 0 ? (
          <p className={styles.empty}>{translateTravel('暂无待接受邀请')}</p>
        ) : (
          <div className={styles.list}>
            {invitations.map((invitation, index) => {
              const title = invitation.ownerDisplayName
                ? translateTravel('{{v0}}用户的群组', { v0: invitation.ownerDisplayName })
                : resolveTitle(invitation.title);
              const actionKey = `accept:${invitation.invitationId}`;
              const automaticOwnerBilling = invitation.billingMode === 'automatic_owner';
              const requestLimit = invitation.sponsorship?.maxCreditsPerRequest;
              const periodLimit = invitation.sponsorship?.maxCreditsPerPeriod;
              const isOwnerSponsored = Boolean(
                invitation.sponsorship?.billingResponsibility === 'group_owner' &&
                requestLimit &&
                periodLimit &&
                Number.isSafeInteger(requestLimit) &&
                Number.isSafeInteger(periodLimit) &&
                requestLimit > 0 &&
                requestLimit <= periodLimit,
              );
              return (
                <div key={invitation.invitationId}>
                  {index > 0 && <Divider style={{ margin: 0 }} />}
                  <Flexbox
                    horizontal
                    align="center"
                    className={styles.row}
                    gap={12}
                    justify="space-between"
                  >
                    <Flexbox horizontal align="center" className={styles.rowContent} gap={10}>
                      <Avatar
                        avatar={invitation.avatar?.trim() || DEFAULT_USER_AVATAR_URL}
                        size={32}
                        title={title}
                      />
                      <Flexbox className={styles.rowContent} gap={4}>
                        <Text ellipsis title={title} weight={600}>
                          {title}
                        </Text>
                        <Text type="secondary">
                          {translateTravel('到期时间：')}
                          {formatDateTime(invitation.expiresAt, locale)}
                        </Text>
                        {automaticOwnerBilling ? (
                          <Text type="secondary">
                            {translateTravel(
                              '群内实际 Token 消耗自动计入群所属账号，无需设置代付。',
                            )}
                          </Text>
                        ) : isOwnerSponsored ? (
                          <Flexbox gap={2}>
                            <Text type="secondary">{translateTravel('费用由群主承担')}</Text>
                            <Text type="secondary">
                              {translateTravel('单次')}
                              {requestLimit} {translateTravel('/ 周期')}
                              {periodLimit} {translateTravel('积分')}
                            </Text>
                          </Flexbox>
                        ) : (
                          <Text type="secondary">{translateTravel('AI任务未开放')}</Text>
                        )}
                      </Flexbox>
                    </Flexbox>
                    <Button
                      aria-label={translateTravel('接受{{v0}}的邀请', { v0: title })}
                      className={styles.action}
                      disabled={Boolean(busyAction)}
                      loading={busyAction === actionKey}
                      onClick={() =>
                        void handleAccept(invitation.invitationId, automaticOwnerBilling)
                      }
                    >
                      {translateTravel('接受邀请')}
                    </Button>
                  </Flexbox>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="my-collaboration-groups">
        <h2 className={styles.sectionTitle} id="my-collaboration-groups">
          <UsersRound aria-hidden size={18} />
          {translateTravel('我的协作群')}
          {groupsQuery.data && <Tag>{groups.length}</Tag>}
        </h2>
        {groupsQuery.isLoading ? (
          <SkeletonBar height={80} />
        ) : groupsQuery.isError ? (
          <Alert
            showIcon
            action={
              <Button onClick={() => void groupsQuery.refetch()}>{translateTravel('重试')}</Button>
            }
            title={translateTravel('协作群暂时无法读取。')}
            type="error"
          />
        ) : groups.length === 0 ? (
          <p className={styles.empty}>{translateTravel('暂无协作群')}</p>
        ) : (
          <div className={styles.list}>
            {groups.map((group, index) => {
              const title =
                group.kind === 'member' && group.ownerDisplayName
                  ? translateTravel('{{v0}}用户的群组', { v0: group.ownerDisplayName })
                  : resolveTitle(group.title);
              const isMember = group.kind === 'member';
              const actionKey = `leave:${group.groupId}`;
              return (
                <div key={group.groupId}>
                  {index > 0 && <Divider style={{ margin: 0 }} />}
                  <Flexbox
                    horizontal
                    align="center"
                    className={styles.row}
                    gap={12}
                    justify="space-between"
                  >
                    <Flexbox horizontal align="center" className={styles.rowContent} gap={10}>
                      <Avatar
                        avatar={group.avatar?.trim() || DEFAULT_USER_AVATAR_URL}
                        size={32}
                        title={title}
                      />
                      <Flexbox className={styles.rowContent} gap={4}>
                        <Flexbox horizontal align="center" className={styles.meta} gap={8}>
                          <Text ellipsis title={title} weight={600}>
                            {title}
                          </Text>
                          <Tag>
                            {isMember
                              ? translateTravel('协作成员')
                              : translateTravel('我创建的群组')}
                          </Tag>
                        </Flexbox>
                        {isMember && group.joinedAt && (
                          <Text type="secondary">
                            {translateTravel('加入时间：')}
                            {formatDateTime(group.joinedAt, locale)}
                          </Text>
                        )}
                      </Flexbox>
                    </Flexbox>
                    <Flexbox horizontal align="center" className={styles.actions} gap={8}>
                      <Link
                        aria-label={translateTravel('进入{{v0}}群聊', { v0: title })}
                        className={styles.chatLink}
                        to={{ pathname: `/group/${encodeURIComponent(group.groupId)}` }}
                      >
                        {translateTravel('进入群聊')}
                      </Link>
                      {isMember && (
                        <Button
                          danger
                          aria-label={translateTravel('退出{{v0}}', { v0: title })}
                          className={styles.action}
                          disabled={Boolean(busyAction)}
                          loading={busyAction === actionKey}
                          onClick={() => confirmLeave(group)}
                        >
                          {translateTravel('退出群组')}
                        </Button>
                      )}
                    </Flexbox>
                  </Flexbox>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default GroupInvitations;
