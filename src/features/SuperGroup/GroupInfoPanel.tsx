'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Alert, Avatar, Button, confirmModal, createModal, Popover } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  ChevronRight,
  FolderOpen,
  History,
  LogOut,
  Logs,
  Megaphone,
  StickyNote,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useState } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { DEFAULT_AVATAR } from '@/const/meta';
import AgentProfileCard from '@/features/AgentProfileCard';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import MemberPanel from '@/features/GroupMembership/MemberPanel';
import { openShareModal } from '@/features/ShareModal';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';

import GroupLogs from './GroupLogs';
import RecentTopicLinks from './RecentTopicLinks';

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    overflow: auto;
    overscroll-behavior: contain;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-height: min(720px, calc(100dvh - 100px));
    padding: 16px;

    color: ${cssVar.colorText};
  `,
  members: css`
    scrollbar-width: thin;

    overflow-y: auto;
    overscroll-behavior: contain;
    display: grid;
    grid-auto-rows: minmax(96px, auto);
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px 4px;

    max-height: 208px;
    padding: 2px;
  `,
  member: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;

    min-width: 0;
    padding-block: 4px;
    padding-inline: 0;
    border: 0;
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: inherit;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  name: css`
    overflow: hidden;

    width: 100%;

    font-size: 12px;
    line-height: 16px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rowLabel: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;

    > svg {
      flex-shrink: 0;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  row: css`
    display: flex;
    gap: 12px;
    align-items: center;

    box-sizing: border-box;
    width: calc(100% + 32px);
    min-height: 52px;
    margin-inline: -16px;
    padding-block: 12px;
    padding-inline: 20px;
    border: 0;
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

    font: inherit;
    font-size: ${cssVar.fontSizeSM};
    color: inherit;
    text-align: start;

    background: transparent;

    & > :first-child {
      flex-shrink: 0;
    }

    & > svg {
      flex-shrink: 0;
      color: ${cssVar.colorTextTertiary};
    }

    &[type='button'] {
      cursor: pointer;
    }

    &[type='button']:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  value: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    color: ${cssVar.colorTextSecondary};
    text-align: end;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  text: css`
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  editor: css`
    resize: vertical;

    box-sizing: border-box;
    width: 100%;
    min-height: 160px;
    max-height: 320px;
    padding: 12px;
    border: 0.5px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    font: inherit;
    color: inherit;

    background: ${cssVar.colorBgContainer};

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
}));

type Person = { avatar?: string | null; id: string; name: string; role?: string };

export default function GroupInfoPanel({
  groupId,
  manageDefaultGroup = false,
  onClose,
  shareOptions,
}: {
  groupId: string;
  manageDefaultGroup?: boolean;
  onClose: () => void;
  shareOptions?: Parameters<typeof openShareModal>[0];
}) {
  const router = useQueryRoute();
  const [offset, setOffset] = useState(0);
  const [previousMembers, setPreviousMembers] = useState<Person[]>([]);
  const [section, setSection] = useState<'announcement' | 'remark'>();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [openingFiles, setOpeningFiles] = useState(false);
  const { allowed: canShare, reason: shareDeniedReason } = usePermission('edit_own_content');
  const info = lambdaQuery.groupInfo.get.useQuery({ groupId }, { gcTime: 0, retry: false });
  const participants = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId, offset, limit: 50 },
    { gcTime: 0, retry: false },
  );
  const announcement = lambdaQuery.groupInfo.updateAnnouncement.useMutation();
  const remark = lambdaQuery.groupInfo.updateRemark.useMutation();
  const leave = lambdaQuery.groupMembership.leaveGroup.useMutation();
  const queryUtils = lambdaQuery.useUtils();

  const openMembers = () => {
    onClose();
    createModal({
      title: '群成员',
      width: 'min(560px, calc(100vw - 32px))',
      footer: null,
      content: <MemberPanel groupId={groupId} manageDefaultGroup={manageDefaultGroup} />,
    });
  };
  if (info.isLoading) return <SkeletonBar height={300} />;
  if (info.isError || !info.data)
    return (
      <Alert
        action={<Button onClick={() => void info.refetch()}>重试</Button>}
        title="群信息加载失败"
        type="error"
      />
    );

  const data = info.data;
  const people = [
    ...previousMembers,
    ...(participants.data?.items ?? []).map((person) => ({
      id: person.memberUserId,
      avatar: person.avatar,
      name: person.displayName || '群成员',
      role: person.role,
    })),
  ];
  const assistants = participants.data?.assistants ?? [];
  const editable = section === 'remark' || data.canEditAnnouncement;
  const edit = (next: 'announcement' | 'remark') => {
    setDraft(data[next]);
    setError('');
    setSection(next);
  };
  const save = async () => {
    if (saving || !section) return;
    setSaving(true);
    setError('');
    try {
      if (section === 'announcement')
        await announcement.mutateAsync({ groupId, announcement: draft });
      else await remark.mutateAsync({ groupId, remark: draft });
      await info.refetch();
      setSection(undefined);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="群信息" className={styles.panel}>
      {section ? (
        <Flexbox gap={12}>
          <Flexbox horizontal align="center" justify="space-between">
            <Button
              aria-label="返回群信息"
              disabled={saving}
              type="text"
              onClick={() => setSection(undefined)}
            >
              返回
            </Button>
            <strong>{section === 'announcement' ? '群公告' : '备注'}</strong>
          </Flexbox>
          <span style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
            {section === 'announcement'
              ? '群主编辑，全群可见'
              : '仅自己可见，不会分享给群主或其他成员'}
          </span>
          {editable ? (
            <>
              <textarea
                aria-label={section === 'announcement' ? '群公告' : '备注'}
                className={styles.editor}
                disabled={saving}
                maxLength={section === 'announcement' ? 4000 : 1000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              {error && <Alert title={error} type="error" />}
              <Button loading={saving} type="primary" onClick={() => void save()}>
                保存
              </Button>
            </>
          ) : (
            <p className={styles.text}>{data.announcement || '暂无群公告'}</p>
          )}
        </Flexbox>
      ) : (
        <>
          <Flexbox horizontal align="center" justify="space-between" style={{ paddingBottom: 8 }}>
            <strong>群成员</strong>
            <Button size="small" type="text" onClick={openMembers}>
              查看所有成员
            </Button>
          </Flexbox>
          {participants.isError ? (
            <Alert
              action={<Button onClick={() => void participants.refetch()}>重试</Button>}
              title="成员加载失败"
              type="error"
            />
          ) : participants.isLoading ? (
            <SkeletonBar height={80} />
          ) : (
            <div aria-label="群成员列表" className={styles.members}>
              {people.map((person) => (
                <Popover
                  nativeButton
                  key={person.id}
                  placement="bottom"
                  styles={{ content: { padding: 0, borderRadius: 12, overflow: 'hidden' } }}
                  trigger="click"
                  content={
                    <AgentProfileCard
                      avatar={person.avatar}
                      description={person.role === 'owner' ? '群主' : '群成员'}
                      title={person.name}
                    />
                  }
                >
                  <button
                    aria-label={person.name}
                    className={styles.member}
                    title={person.name}
                    type="button"
                  >
                    <Avatar
                      avatar={person.avatar || DEFAULT_AVATAR}
                      size={44}
                      title={person.name}
                    />
                    <span className={styles.name}>{person.name}</span>
                    <span className={styles.name} style={{ color: cssVar.colorTextSecondary }}>
                      {person.role === 'owner' ? '群主' : '群成员'}
                    </span>
                  </button>
                </Popover>
              ))}
              {assistants.map((agent) => (
                <AgentProfilePopup
                  nativeButton
                  agentId={agent.id}
                  groupId={groupId}
                  key={agent.id}
                  agent={{
                    avatar: agent.avatar ?? undefined,
                    name: agent.title ?? undefined,
                    title: agent.subtitle ?? agent.title ?? undefined,
                    description: agent.description ?? undefined,
                    model: agent.model ?? undefined,
                    provider: agent.provider ?? undefined,
                  }}
                >
                  <button
                    aria-label={agent.title || 'AI 助手'}
                    className={styles.member}
                    title={agent.title || 'AI 助手'}
                    type="button"
                  >
                    <Avatar
                      avatar={agent.avatar || DEFAULT_AVATAR}
                      size={44}
                      title={agent.title || 'AI 助手'}
                    />
                    <span className={styles.name}>{agent.title || 'AI 助手'}</span>
                    <span
                      className={styles.name}
                      style={{ color: cssVar.colorTextSecondary }}
                      title={
                        agent.isSupervisor
                          ? ['主管', agent.subtitle].filter(Boolean).join(' · ')
                          : agent.subtitle || undefined
                      }
                    >
                      {agent.isSupervisor
                        ? ['主管', agent.subtitle].filter(Boolean).join(' · ')
                        : agent.subtitle}
                    </span>
                  </button>
                </AgentProfilePopup>
              ))}
              {participants.data?.nextOffset != null && (
                <Button
                  onClick={() => {
                    setPreviousMembers(people);
                    setOffset(participants.data!.nextOffset!);
                  }}
                >
                  更多成员
                </Button>
              )}
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.rowLabel}>
              <UsersRound aria-hidden size={16} />
              群名称
            </span>
            <span className={styles.value} title={data.name || ''}>
              {data.name || '未命名群'}
            </span>
          </div>
          <button
            className={styles.row}
            type="button"
            onClick={() => {
              onClose();
              const modal = createModal({
                title: '群日志',
                width: 'min(900px, calc(100vw - 32px))',
                footer: null,
                content: <GroupLogs groupId={groupId} onNavigate={() => modal.close()} />,
              });
            }}
          >
            <span className={styles.rowLabel}>
              <Logs aria-hidden size={16} />
              群日志
            </span>
            <span className={styles.value} />
            <ChevronRight size={16} />
          </button>
          <button
            className={styles.row}
            type="button"
            onClick={() => {
              onClose();
              const modal = createModal({
                title: '群历史记录',
                width: 'min(560px, calc(100vw - 32px))',
                footer: null,
                content: (
                  <div style={{ maxHeight: '60dvh', overflowY: 'auto' }}>
                    <RecentTopicLinks
                      defaultExpanded
                      groupId={groupId}
                      scrollWithinSection={false}
                      onSelectTopic={(topicId, messageId) => {
                        router.replace(
                          `${GROUP_CHAT_URL(groupId)}/${topicId}${messageId ? `#${encodeURIComponent(messageId)}` : ''}`,
                        );
                        modal.close();
                      }}
                    />
                  </div>
                ),
              });
            }}
          >
            <span className={styles.rowLabel}>
              <History aria-hidden size={16} />
              群历史记录
            </span>
            <span className={styles.value}>最近 20 条话题</span>
            <ChevronRight size={16} />
          </button>
          <button className={styles.row} type="button" onClick={() => edit('announcement')}>
            <span className={styles.rowLabel}>
              <Megaphone aria-hidden size={16} />
              群公告
            </span>
            <span className={styles.value}>{data.announcement || '未设置'}</span>
            <ChevronRight size={16} />
          </button>
          <button className={styles.row} type="button" onClick={() => edit('remark')}>
            <span className={styles.rowLabel}>
              <StickyNote aria-hidden size={16} />
              备注
            </span>
            <span className={styles.value}>{data.remark || '仅自己可见'}</span>
            <ChevronRight size={16} />
          </button>
          <div className={styles.row}>
            <span className={styles.rowLabel}>
              <UserRound aria-hidden size={16} />
              我在本群的昵称
            </span>
            <span className={styles.value} title={data.nickname}>
              {data.nickname || '未设置'}
            </span>
          </div>
          {error && <Alert title={error} type="error" />}
          <Flexbox horizontal gap={12} style={{ paddingTop: 16 }}>
            <Button
              disabled={!shareOptions || !canShare || openingFiles}
              icon={<FolderOpen size={18} />}
              style={{ flex: 1, fontSize: cssVar.fontSizeSM, minHeight: 44 }}
              title={!canShare ? shareDeniedReason : undefined}
              onClick={async () => {
                if (!shareOptions || !canShare || openingFiles) return;
                setOpeningFiles(true);
                try {
                  await openShareModal({ ...shareOptions, title: '群文件' });
                  onClose();
                } catch {
                  setError('群文件面板加载失败，请重试');
                } finally {
                  setOpeningFiles(false);
                }
              }}
            >
              群文件
            </Button>
            <Button
              danger
              icon={<LogOut size={18} />}
              style={{ flex: 1, fontSize: cssVar.fontSizeSM, minHeight: 44 }}
              title={data.canEditAnnouncement ? '群主不能退出自己创建的群' : undefined}
              disabled={
                data.canEditAnnouncement || !participants.data || participants.isError || saving
              }
              onClick={() =>
                confirmModal({
                  title: '确认退出群？',
                  content:
                    '退出后将失去本群访问权限，本群的会话入口和历史记录将从你的账号中清除。其他成员的记录及你自己的群不受影响。',
                  okText: '退出群',
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    if (saving) return;
                    setSaving(true);
                    setError('');
                    try {
                      await leave.mutateAsync({
                        groupId,
                        expectedMembershipVersion: participants.data!.viewerMembershipVersion,
                      });
                    } catch {
                      setError('退出失败，请刷新后重试');
                      setSaving(false);
                      return;
                    }
                    onClose();
                    router.push('/group/default', { replace: true });
                    void queryUtils.groupConversation.listGroups.invalidate();
                  },
                })
              }
            >
              退出群
            </Button>
          </Flexbox>
        </>
      )}
    </section>
  );
}
