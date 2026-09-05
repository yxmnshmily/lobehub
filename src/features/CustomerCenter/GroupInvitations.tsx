'use client';

import { Flexbox, FormGroup, Skeleton } from '@lobehub/ui';
import { Alert, Avatar, Button, confirmModal, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider, Empty } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import { lambdaQuery } from '@/libs/trpc/client';

interface GroupInvitationsProps {
  locale: string;
}

type Feedback = { message: string; type: 'error' | 'success' };

const styles = createStaticStyles(({ css, responsive }) => ({
  action: css`
    flex: none;
  `,
  actions: css`
    flex: none;
    flex-wrap: wrap;
  `,
  chatLink: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;

    min-height: 32px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
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
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  meta: css`
    flex-wrap: wrap;
  `,
  row: css`
    min-width: 0;
    padding: 12px;

    ${responsive.sm} {
      align-items: flex-start;
    }
  `,
  rowContent: css`
    min-width: 0;
  `,
  sectionTitle: css`
    margin-block-end: 8px;
  `,
}));

const formatDateTime = (value: Date, locale: string) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '时间未知';

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  } catch {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value);
  }
};

const resolveTitle = (title: string | null) => title?.trim() || '未命名群组';

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
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const actionInFlight = useRef(false);

  const invitationsQuery = lambdaQuery.groupMembership.listMyPendingInvitations.useQuery(
    undefined,
    { retry: false },
  );
  const groupsQuery = lambdaQuery.groupConversation.listGroups.useQuery(undefined, {
    retry: false,
  });
  const acceptInvitation = lambdaQuery.groupMembership.acceptMyInvitation.useMutation();
  const leaveGroup = lambdaQuery.groupMembership.leaveGroup.useMutation();

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    refresh: () => Promise<unknown>,
    successMessage: string,
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
            ? '邀请中的代付设置已变更，请群主重新邀请。'
            : '操作未完成，请重试。',
        type: 'error',
      });
    } finally {
      actionInFlight.current = false;
      setBusyAction(undefined);
    }
  };

  const handleAccept = async (invitationId: string) => {
    await runAction(
      `accept:${invitationId}`,
      () => acceptInvitation.mutateAsync({ invitationId }),
      () => Promise.all([invitationsQuery.refetch(), groupsQuery.refetch()]),
      '已接受群组邀请。',
    );
  };

  const confirmLeave = (group: {
    groupId: string;
    kind: 'member' | 'owner';
    membershipVersion: number;
    title: string | null;
  }) => {
    if (group.kind !== 'member' || actionInFlight.current) return;
    const title = resolveTitle(group.title);

    confirmModal({
      content: '退出后，你将无法继续查看该群组的对话内容。',
      okButtonProps: { danger: true },
      okText: '退出群组',
      onOk: async () => {
        await runAction(
          `leave:${group.groupId}`,
          () =>
            leaveGroup.mutateAsync({
              expectedMembershipVersion: group.membershipVersion,
              groupId: group.groupId,
            }),
          () => groupsQuery.refetch(),
          `已退出${title}。`,
        );
      },
      title: `退出${title}？`,
    });
  };

  const invitations = invitationsQuery.data?.items ?? [];
  const groups = groupsQuery.data ?? [];

  return (
    <FormGroup collapsible={false} gap={16} title="群组邀请与协作" variant="filled">
      {feedback && <Alert showIcon title={feedback.message} type={feedback.type} />}

      <section aria-labelledby="pending-group-invitations">
        <Text as="h2" className={styles.sectionTitle} id="pending-group-invitations" weight={600}>
          待接受邀请
        </Text>
        {invitationsQuery.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : invitationsQuery.isError ? (
          <Alert
            showIcon
            action={<Button onClick={() => void invitationsQuery.refetch()}>重试</Button>}
            title="群组邀请暂时无法读取。"
            type="error"
          />
        ) : invitations.length === 0 ? (
          <Empty description="暂无待接受邀请" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className={styles.list}>
            {invitations.map((invitation, index) => {
              const title = resolveTitle(invitation.title);
              const actionKey = `accept:${invitation.invitationId}`;
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
                      <Avatar avatar={invitation.avatar || undefined} size={32} title={title} />
                      <Flexbox className={styles.rowContent} gap={4}>
                        <Text ellipsis title={title} weight={600}>
                          {title}
                        </Text>
                        <Text type="secondary">
                          到期时间：{formatDateTime(invitation.expiresAt, locale)}
                        </Text>
                        {isOwnerSponsored ? (
                          <Flexbox gap={2}>
                            <Text type="secondary">费用由群主承担</Text>
                            <Text type="secondary">
                              单次 {requestLimit} / 周期 {periodLimit} Credits
                            </Text>
                          </Flexbox>
                        ) : (
                          <Text type="secondary">AI任务未开放</Text>
                        )}
                      </Flexbox>
                    </Flexbox>
                    <Button
                      aria-label={`接受${title}的邀请`}
                      className={styles.action}
                      disabled={Boolean(busyAction)}
                      loading={busyAction === actionKey}
                      onClick={() => void handleAccept(invitation.invitationId)}
                    >
                      接受邀请
                    </Button>
                  </Flexbox>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Divider style={{ margin: 0 }} />

      <section aria-labelledby="my-collaboration-groups">
        <Text as="h2" className={styles.sectionTitle} id="my-collaboration-groups" weight={600}>
          我的协作群
        </Text>
        {groupsQuery.isLoading ? (
          <Skeleton active paragraph={{ rows: 2 }} title={false} />
        ) : groupsQuery.isError ? (
          <Alert
            showIcon
            action={<Button onClick={() => void groupsQuery.refetch()}>重试</Button>}
            title="协作群暂时无法读取。"
            type="error"
          />
        ) : groups.length === 0 ? (
          <Empty description="暂无协作群" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className={styles.list}>
            {groups.map((group, index) => {
              const title = resolveTitle(group.title);
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
                      <Avatar avatar={group.avatar || undefined} size={32} title={title} />
                      <Flexbox className={styles.rowContent} gap={4}>
                        <Flexbox horizontal align="center" className={styles.meta} gap={8}>
                          <Text ellipsis title={title} weight={600}>
                            {title}
                          </Text>
                          <Tag>{isMember ? '协作成员' : '我创建的群组'}</Tag>
                        </Flexbox>
                        {isMember && group.joinedAt && (
                          <Text type="secondary">
                            加入时间：{formatDateTime(group.joinedAt, locale)}
                          </Text>
                        )}
                      </Flexbox>
                    </Flexbox>
                    <Flexbox horizontal align="center" className={styles.actions} gap={8}>
                      <Link
                        aria-label={`进入${title}群聊`}
                        className={styles.chatLink}
                        to={{ pathname: `/group/${encodeURIComponent(group.groupId)}` }}
                      >
                        进入群聊
                      </Link>
                      {isMember && (
                        <Button
                          danger
                          aria-label={`退出${title}`}
                          className={styles.action}
                          disabled={Boolean(busyAction)}
                          loading={busyAction === actionKey}
                          onClick={() => confirmLeave(group)}
                        >
                          退出群组
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
    </FormGroup>
  );
};

export default GroupInvitations;
