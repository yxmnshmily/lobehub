'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { AccordionItem, Flexbox } from '@lobehub/ui';
import { Avatar, Button, confirmModal, Input, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import type { FormEvent } from 'react';
import { memo, useEffect, useRef, useState } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import SponsoredPolicyPanel from './SponsoredPolicyPanel';

interface HumanMembersProps {
  itemKey: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  form: css`
    display: flex;
    gap: 8px;
    align-items: center;
    padding-block: 4px 8px;
  `,
  input: css`
    min-width: 0;
  `,
  list: css`
    overflow: hidden;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    & > * + * {
      border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
    }
  `,
  row: css`
    min-width: 0;
    padding: 8px;
  `,
  rowText: css`
    min-width: 0;
    overflow-wrap: anywhere;
  `,
}));

const HumanMembers = memo<HumanMembersProps>(({ itemKey }) => {
  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const group = useAgentGroupStore((state) =>
    activeGroupId ? state.groupMap[activeGroupId] : undefined,
  );
  const isSupergroup =
    group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId;
  const [contact, setContact] = useState('');
  const [feedback, setFeedback] = useState<string>();
  const [busyAction, setBusyAction] = useState<string>();
  const actionInFlight = useRef(false);

  const membersQuery = lambdaQuery.groupMembership.listMembers.useQuery(
    { groupId: activeGroupId || '' },
    { enabled: Boolean(activeGroupId), retry: false },
  );
  const pendingQuery = lambdaQuery.groupMembership.listPendingInvitations.useQuery(
    { groupId: activeGroupId || '' },
    { enabled: Boolean(activeGroupId), retry: false },
  );
  const createInvitation = lambdaQuery.groupMembership.createInvitation.useMutation();
  const revokeInvitation = lambdaQuery.groupMembership.revokeInvitation.useMutation();
  const removeMember = lambdaQuery.groupMembership.removeMember.useMutation();

  useEffect(() => {
    setContact('');
    setFeedback(undefined);
    setBusyAction(undefined);
    actionInFlight.current = false;
  }, [activeGroupId]);

  const refresh = async () => {
    await Promise.all([membersQuery.refetch(), pendingQuery.refetch()]);
  };

  const runAction = async (key: string, action: () => Promise<unknown>, success: string) => {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusyAction(key);
    setFeedback(undefined);

    try {
      await action();
      await refresh();
      setFeedback(success);
      return true;
    } catch {
      setFeedback('操作未完成，请稍后重试');
      return false;
    } finally {
      actionInFlight.current = false;
      setBusyAction(undefined);
    }
  };

  const handleInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeGroupId) return;

    const normalizedContact = contact.trim();
    if (!normalizedContact) {
      setFeedback('请输入用户 ID、手机号或邮箱');
      return;
    }

    const created = await runAction(
      'invite',
      () => createInvitation.mutateAsync({ contact: normalizedContact, groupId: activeGroupId }),
      '邀请已创建',
    );
    if (created) setContact('');
  };

  const confirmRevoke = (invitationId: string, maskedEmail: string | null) => {
    if (!activeGroupId || actionInFlight.current) return;
    confirmModal({
      content: '撤销后，该邀请将无法继续接受。',
      okButtonProps: { danger: true },
      okText: '撤销邀请',
      onOk: async () => {
        await runAction(
          `invite:${invitationId}`,
          () => revokeInvitation.mutateAsync({ groupId: activeGroupId, invitationId }),
          '邀请已撤销',
        );
      },
      title: `撤销 ${maskedEmail} 的邀请？`,
    });
  };

  const confirmRemove = (member: {
    displayName: string | null;
    memberUserId: string;
    membershipVersion: number;
  }) => {
    if (!activeGroupId || actionInFlight.current) return;
    const displayName = member.displayName || '未命名成员';
    confirmModal({
      content: '移除后，该成员将立即无法继续访问群聊。',
      okButtonProps: { danger: true },
      okText: '移除成员',
      onOk: async () => {
        await runAction(
          `member:${member.memberUserId}`,
          () =>
            removeMember.mutateAsync({
              expectedMembershipVersion: member.membershipVersion,
              groupId: activeGroupId,
              memberUserId: member.memberUserId,
            }),
          '成员已移除',
        );
      },
      title: `移除 ${displayName}？`,
    });
  };

  const isLoading = Boolean(activeGroupId) && (membersQuery.isLoading || pendingQuery.isLoading);
  const isAvailable =
    Boolean(activeGroupId) &&
    !membersQuery.isError &&
    !pendingQuery.isError &&
    Boolean(membersQuery.data && pendingQuery.data);
  const members = membersQuery.data?.items ?? [];
  const invitations = pendingQuery.data?.items ?? [];
  const title = isAvailable && members.length > 0 ? `真人成员 ${members.length}` : '真人成员';

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Text ellipsis fontSize={12} type="secondary" weight={500}>
          {title}
        </Text>
      }
    >
      {isLoading ? (
        <SkeletonBar height={72} />
      ) : !isAvailable ? (
        <Text fontSize={12} type="secondary">
          真人成员管理暂不可用
        </Text>
      ) : (
        <Flexbox gap={8} paddingBlock={1}>
          <form className={styles.form} onSubmit={handleInvite}>
            <Input
              required
              aria-label="用户 ID / 手机号 / 邮箱"
              autoCapitalize="none"
              autoComplete="off"
              className={styles.input}
              disabled={Boolean(busyAction)}
              maxLength={320}
              placeholder="用户 ID / 手机号 / 邮箱"
              spellCheck={false}
              type="text"
              value={contact}
              onChange={(event) => {
                setContact(event.target.value);
                if (feedback) setFeedback(undefined);
              }}
            />
            <Button
              disabled={Boolean(busyAction) || !contact.trim()}
              htmlType="submit"
              loading={busyAction === 'invite'}
              size="small"
              type="primary"
            >
              发送邀请
            </Button>
          </form>

          {feedback && (
            <Text
              aria-live="polite"
              fontSize={12}
              type={
                feedback.includes('未完成') || feedback.includes('有效') ? 'danger' : 'secondary'
              }
            >
              {feedback}
            </Text>
          )}

          <Text fontSize={12} type="secondary" weight={500}>
            待处理邀请
          </Text>
          {invitations.length === 0 ? (
            <Text fontSize={12} type="secondary">
              暂无待处理邀请
            </Text>
          ) : (
            <Flexbox className={styles.list}>
              {invitations.map((invitation) => (
                <Flexbox
                  horizontal
                  align="center"
                  className={styles.row}
                  gap={8}
                  justify="space-between"
                  key={invitation.invitationId}
                >
                  <Text ellipsis className={styles.rowText} fontSize={12}>
                    {invitation.maskedEmail}
                  </Text>
                  <Button
                    danger
                    aria-label={`撤销 ${invitation.maskedEmail} 的邀请`}
                    disabled={Boolean(busyAction)}
                    loading={busyAction === `invite:${invitation.invitationId}`}
                    size="small"
                    type="text"
                    onClick={() => confirmRevoke(invitation.invitationId, invitation.maskedEmail)}
                  >
                    撤销
                  </Button>
                </Flexbox>
              ))}
            </Flexbox>
          )}

          <Text fontSize={12} type="secondary" weight={500}>
            已加入成员
          </Text>
          {members.length === 0 ? (
            <Text fontSize={12} type="secondary">
              暂无真人成员
            </Text>
          ) : (
            <Flexbox className={styles.list}>
              {members.map((member) => {
                const displayName = member.displayName || '未命名成员';
                return (
                  <Flexbox
                    horizontal
                    align="center"
                    className={styles.row}
                    gap={8}
                    justify="space-between"
                    key={member.memberUserId}
                  >
                    <Flexbox horizontal align="center" className={styles.rowText} gap={8}>
                      <Avatar avatar={member.avatar || undefined} size={24} title={displayName} />
                      <Text ellipsis className={styles.rowText} fontSize={12}>
                        {displayName}
                      </Text>
                    </Flexbox>
                    <Button
                      danger
                      aria-label={`移除 ${displayName}`}
                      disabled={Boolean(busyAction)}
                      loading={busyAction === `member:${member.memberUserId}`}
                      size="small"
                      type="text"
                      onClick={() => confirmRemove(member)}
                    >
                      移除
                    </Button>
                  </Flexbox>
                );
              })}
            </Flexbox>
          )}
          {!isSupergroup && (
            <SponsoredPolicyPanel
              groupId={activeGroupId!}
              members={members}
              onMembersChanged={membersQuery.refetch}
            />
          )}
        </Flexbox>
      )}
    </AccordionItem>
  );
});

export default HumanMembers;
