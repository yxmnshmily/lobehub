'use client';

import { Flexbox, Input } from '@lobehub/ui';
import { Alert, Avatar, Button, confirmModal, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
import { DEFAULT_AVATAR } from '@/const/meta';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';

import AssistantActions from './AssistantActions';
import DefaultGroupActions from './DefaultGroupActions';
import InvitationForm from './InvitationForm';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow: auto;
    overscroll-behavior: contain;

    min-width: 0;
    max-height: min(640px, calc(100dvh - 160px));
    padding: 4px;

    & > * {
      flex-shrink: 0;
    }
  `,
  details: css`
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  row: css`
    min-width: 0;
    padding-block: 8px;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  assistant: css`
    cursor: pointer;

    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;

    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding: 8px;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  name: css`
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  `,
}));

const MemberPanel = ({
  groupId,
  manageDefaultGroup = false,
}: {
  groupId: string;
  manageDefaultGroup?: boolean;
}) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const router = useQueryRoute();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [expandedAgent, setExpandedAgent] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState<{ message: string; type: 'error' | 'success' }>();
  const query = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId, limit: 50, offset },
    { gcTime: 0, refetchOnWindowFocus: true, retry: false },
  );
  const queryUtils = lambdaQuery.useUtils();
  const remove = lambdaQuery.groupMembership.removeMember.useMutation();
  const leave = lambdaQuery.groupMembership.leaveGroup.useMutation();
  const owner = query.data?.viewerRole === 'owner';
  const agents = query.data?.assistants;

  const run = async (action: () => Promise<unknown>, message: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback({ message, type: 'success' });
      await query.refetch();
    } catch {
      setFeedback({
        message: t('groupMembership.actionError', {
          defaultValue: 'The action could not be completed. Refresh the member list and try again.',
        }),
        type: 'error',
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (query.isLoading) return <SkeletonBar height={120} />;
  if (query.isError || !query.data)
    return (
      <Alert
        showIcon
        title={t('groupMembership.loadError', { defaultValue: 'Members could not be loaded.' })}
        type="error"
        action={
          <Button onClick={() => void query.refetch()}>
            {t('groupMembership.retry', { defaultValue: 'Retry' })}
          </Button>
        }
      />
    );

  const searchTerm = search.trim().toLocaleLowerCase();
  const filteredAgents = (agents ?? []).filter((agent) =>
    `${agent.title ?? ''} ${agent.subtitle ?? ''} ${agent.description ?? ''}`
      .toLocaleLowerCase()
      .includes(searchTerm),
  );

  return (
    <Flexbox className={styles.body} gap={16}>
      <InvitationForm disabled={busy} groupId={groupId} />
      {feedback && <Alert showIcon title={feedback.message} type={feedback.type} />}
      <section>
        <Text as="h3" weight={600}>
          {t('groupMembership.people', { defaultValue: 'People' })}
        </Text>
        {query.data.items.map((person) => (
          <Flexbox
            horizontal
            align="center"
            className={styles.row}
            gap={12}
            key={person.memberUserId}
          >
            <Avatar
              avatar={person.avatar || undefined}
              size={36}
              title={person.displayName ?? undefined}
            />
            <Flexbox className={styles.name} gap={4}>
              <Text>{person.displayName}</Text>
              {person.role === 'owner' && (
                <Text type="secondary">
                  {t('groupMembership.owner', { defaultValue: 'Group owner' })}
                </Text>
              )}
              {person.role === 'member' && <Text type="secondary">访客</Text>}
            </Flexbox>
            {owner && person.role === 'member' && (
              <Button
                danger
                disabled={busy}
                style={{ flex: 'none' }}
                onClick={() =>
                  confirmModal({
                    title: t('groupMembership.removeTitle', {
                      defaultValue: 'Remove this member?',
                    }),
                    content: t('groupMembership.removeDescription', {
                      defaultValue:
                        'Their access and personal conversation history will be cleared. Other members will keep the group history.',
                    }),
                    okText: t('groupMembership.remove', { defaultValue: 'Remove member' }),
                    okButtonProps: { danger: true },
                    onOk: () =>
                      run(
                        () =>
                          remove.mutateAsync({
                            groupId,
                            memberUserId: person.memberUserId,
                            expectedMembershipVersion: person.membershipVersion,
                          }),
                        t('groupMembership.removed', { defaultValue: 'Member removed.' }),
                      ),
                  })
                }
              >
                {t('groupMembership.remove', { defaultValue: 'Remove member' })}
              </Button>
            )}
          </Flexbox>
        ))}
        {(offset > 0 || query.data.nextOffset !== null) && (
          <Flexbox horizontal gap={8} style={{ marginTop: 8 }}>
            <Button
              disabled={offset === 0 || busy}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              {t('groupMembership.previous', { defaultValue: 'Previous' })}
            </Button>
            <Button
              disabled={query.data.nextOffset === null || busy}
              onClick={() => setOffset(query.data!.nextOffset!)}
            >
              {t('groupMembership.next', { defaultValue: 'Next' })}
            </Button>
          </Flexbox>
        )}
      </section>
      <section>
        <Flexbox gap={8}>
          <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
            <Text as="h3" style={{ marginBlock: 0 }} weight={600}>
              {t('groupMembership.assistants', { defaultValue: 'AI members' })} ·{' '}
              {agents?.length ?? 0}
            </Text>
            {manageDefaultGroup && (
              <DefaultGroupActions
                addAsMenu
                addOnly
                groupId={groupId}
                onUpdated={() => query.refetch()}
              />
            )}
          </Flexbox>
          <Text type="secondary">
            {t('groupMembership.assistantHint', {
              defaultValue:
                'View an assistant’s introduction here. Use @ in the group to work with them.',
            })}
          </Text>
          <Input
            aria-label={t('groupMembership.search', { defaultValue: 'Search assistants' })}
            placeholder={t('groupMembership.search', { defaultValue: 'Search assistants' })}
            style={{ fontSize: 16 }}
            suffix={<Search aria-hidden size={16} style={{ color: cssVar.colorTextTertiary }} />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {filteredAgents.length === 0 && (
            <Text type="secondary">
              {t('groupMembership.noAssistants', { defaultValue: 'No matching assistants.' })}
            </Text>
          )}
          {filteredAgents.map((agent) => (
            <div key={agent.id}>
              <Flexbox horizontal align="center" gap={4} style={{ minWidth: 0 }}>
                <button
                  aria-expanded={expandedAgent === agent.id}
                  className={styles.assistant}
                  type="button"
                  aria-label={
                    agent.title ||
                    t('groupMembership.unnamedAssistant', { defaultValue: 'Assistant' })
                  }
                  onClick={() =>
                    setExpandedAgent(expandedAgent === agent.id ? undefined : agent.id)
                  }
                >
                  <Avatar
                    avatar={agent.avatar || DEFAULT_AVATAR}
                    size={36}
                    title={agent.title || undefined}
                  />
                  <span className={styles.name}>
                    {agent.title ||
                      t('groupMembership.unnamedAssistant', { defaultValue: 'Assistant' })}
                    {(agent.isSupervisor || agent.subtitle) && (
                      <span
                        style={{
                          color: cssVar.colorTextSecondary,
                          fontSize: 12,
                          marginInlineStart: 6,
                        }}
                      >
                        {[
                          agent.isSupervisor && t('supervisor.label', { defaultValue: '主管' }),
                          agent.subtitle,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                </button>
                {manageDefaultGroup && (
                  <AssistantActions
                    agentId={agent.id}
                    groupId={groupId}
                    isSupervisor={agent.isSupervisor}
                    pinned={agent.pinned}
                    sessionGroupId={agent.sessionGroupId}
                    title={agent.title || ''}
                    onNavigate={close}
                    onUpdated={() => query.refetch()}
                  />
                )}
              </Flexbox>
              {expandedAgent === agent.id && (
                <div className={styles.details}>
                  {agent.description ||
                    t('groupMembership.noDescription', {
                      defaultValue: 'No introduction has been added yet.',
                    })}
                </div>
              )}
            </div>
          ))}
        </Flexbox>
      </section>
      {!owner && (
        <Button
          danger
          disabled={busy}
          style={{ minHeight: 40 }}
          onClick={() =>
            confirmModal({
              title: t('groupMembership.leaveTitle', { defaultValue: 'Leave this group?' }),
              content: t('groupMembership.leaveDescription', {
                defaultValue:
                  'Your conversation entry and history for this group will be cleared, and you will lose access. Other members will keep the group history. Your own super group is unaffected.',
              }),
              okText: t('groupMembership.leave', { defaultValue: 'Leave group' }),
              okButtonProps: { danger: true },
              onOk: () =>
                run(
                  async () => {
                    await leave.mutateAsync({
                      groupId,
                      expectedMembershipVersion: query.data!.viewerMembershipVersion,
                    });
                    await queryUtils.groupConversation.listGroups.invalidate();
                    close();
                    router.push('/group/default', { replace: true });
                  },
                  t('groupMembership.left', { defaultValue: 'You have left the group.' }),
                ),
            })
          }
        >
          {t('groupMembership.leave', { defaultValue: 'Leave group' })}
        </Button>
      )}
    </Flexbox>
  );
};

export default MemberPanel;
