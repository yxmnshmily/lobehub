'use client';

import { agentDisplayName, agentSecondaryDisplayName } from '@lobechat/types';
import { Flexbox, Input } from '@lobehub/ui';
import { Alert, Avatar, Button, confirmModal, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Search, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import SkeletonBar from '@/components/Skeleton/Bar';
import AddMemberMenu from '@/features/GroupMembership/AddMemberMenu';
import { lambdaQuery } from '@/libs/trpc/client';
import { useHomeStore } from '@/store/home';
import { getDeleteErrorMessageKey } from '@/utils/forbiddenError';
import { useTravelTranslation } from '@/utils/i18n/travel';

function MemberPublisher({ onUpdated }: { onUpdated?: () => Promise<unknown> }) {
  const translateTravel = useTravelTranslation();
  const { t } = useTranslation('common');
  const deleteAgent = useHomeStore((s) => s.removeAgent);
  const query = lambdaQuery.platformOperations.getSuperGroupTemplate.useQuery(undefined, {
    retry: false,
  });
  const [search, setSearch] = useState('');
  const candidateAnchor = useRef<HTMLDivElement>(null);
  const candidates = lambdaQuery.agent.queryAgents.useQuery(
    { keyword: search, limit: 100 },
    { retry: false },
  );
  const publish = lambdaQuery.platformOperations.importSuperGroupTemplateMember.useMutation();
  const remove = lambdaQuery.platformOperations.removeSuperGroupTemplateMember.useMutation();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState<{ title: string; type: 'error' | 'success' }>();
  const run = async (action: () => Promise<{ syncedGroupCount: number }>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await action();
      await query.refetch();
      await onUpdated?.();
      setFeedback({
        title: translateTravel('已同步到 {{v0}} 个默认群', { v0: result.syncedGroupCount }),
        type: 'success',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      let title = translateTravel('未能完成同步，请刷新成员列表后重试。');
      if (reason.startsWith(translateTravel('设备或本地 CLI 成员不能同步给所有用户'))) {
        title = translateTravel(
          '此成员绑定了设备或本地 CLI，请先在原成员档案中配置服务器模型，再同步。',
        );
      } else if (reason.startsWith(translateTravel('成员包含需单独发布的连接器或资源技能'))) {
        title = translateTravel(
          '此成员包含私人连接器或资源技能，需要先单独发布共享资源。本次未同步任何更改。',
        );
      } else if (reason === 'Member must use a server-available model and provider') {
        title = translateTravel('请先在原成员档案中明确选择服务器可用的模型与服务商，再同步。');
      }
      setFeedback({ title, type: 'error' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const sync = (agentId: string, title: string, key?: string) =>
    confirmModal({
      title: translateTravel('同步成员「{{v0}}」？', { v0: title }),
      content: translateTravel(
        '将成员加入所有用户的默认群，新用户也继承。原配置有本机或未发布资源依赖时，加入后仍会暂停执行，不替换原模型，不清除历史消息。',
      ),
      okText: translateTravel('同步所有默认群'),
      onOk: () =>
        run(() => publish.mutateAsync({ agentId, allowPending: true, ...(key ? { key } : {}) })),
    });
  const deleteCandidate = (agentId: string, title: string) =>
    confirmModal({
      title: translateTravel('删除 {{v0}}', { v0: title }),
      content: t('confirmRemoveSessionItemAlert', { ns: 'chat' }),
      cancelText: t('cancel'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setFeedback(undefined);
        try {
          await deleteAgent(agentId);
          await candidates.refetch();
          setFeedback({ title: t('confirmRemoveSessionSuccess', { ns: 'chat' }), type: 'success' });
        } catch (error) {
          setFeedback({ title: t(getDeleteErrorMessageKey(error)), type: 'error' });
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      },
    });
  if (query.isLoading) return <SkeletonBar height={120} />;
  if (query.isError || !query.data)
    return (
      <Alert
        action={<Button onClick={() => void query.refetch()}>{translateTravel('重试')}</Button>}
        title={translateTravel('成员配置加载失败')}
        type="error"
      />
    );
  const members = query.data.members;
  return (
    <Flexbox gap={12} style={{ minWidth: 0 }}>
      <Text as="h3" weight={600}>
        {translateTravel('默认群成员管理')}
      </Text>
      <Text type="secondary">
        {translateTravel(
          '已加入模板的成员：保存名称、职业、模型、提示词、工具或纯文本技能后，自动同步所有默认群；新用户也继承。无法共享的依赖会阻止保存并提示原因。',
        )}
      </Text>
      <Text type="secondary">
        {translateTravel('群主 AI 负责统筹，不能直接删除；下方管理可配置成员。')}
      </Text>
      {feedback && <Alert {...feedback} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {members.map((member) => (
          <Flexbox
            gap={6}
            key={member.key}
            style={{
              minWidth: 0,
              padding: 10,
              border: `0.5px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 8,
            }}
          >
            <Flexbox horizontal align="center" gap={8}>
              <Avatar avatar={member.avatar || undefined} size={24} />
              <Text fontSize={14} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {agentDisplayName(member)}
              </Text>
              {agentSecondaryDisplayName(member) && (
                <Text fontSize={12} type="secondary">
                  {agentSecondaryDisplayName(member)}
                </Text>
              )}
            </Flexbox>
            <Text fontSize={12} style={{ overflowWrap: 'anywhere' }} type="secondary">
              {[member.provider, member.model].filter(Boolean).join(' · ')}
            </Text>
            <Flexbox horizontal align="center" gap={4} style={{ marginTop: 'auto' }} wrap="wrap">
              {member.sourceAgentId ? (
                <>
                  <Link
                    aria-label={translateTravel('编辑 {{v0}}', { v0: agentDisplayName(member) })}
                    rel="noopener noreferrer"
                    target="_blank"
                    to={`/agent/${encodeURIComponent(member.sourceAgentId)}/profile`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      boxSizing: 'border-box',
                      height: 24,
                      padding: '0 8px',
                      border: '0.5px solid currentColor',
                      borderRadius: 6,
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    {translateTravel('编辑')}
                  </Link>
                  <Button
                    aria-label={translateTravel('同步 {{v0}}', { v0: agentDisplayName(member) })}
                    disabled={busy}
                    size="small"
                    onClick={() =>
                      sync(
                        member.sourceAgentId!,
                        agentDisplayName(member) ?? member.key,
                        member.key,
                      )
                    }
                  >
                    {translateTravel('同步')}
                  </Button>
                </>
              ) : (
                <Text type="secondary">
                  {translateTravel('旧模板成员：请从下方添加已配置成员，再删除此项。')}
                </Text>
              )}
              <Button
                danger
                aria-label={translateTravel('删除 {{v0}}', { v0: agentDisplayName(member) })}
                disabled={busy}
                size="small"
                onClick={() =>
                  confirmModal({
                    title: translateTravel('从所有默认群删除「{{v0}}」？', {
                      v0: agentDisplayName(member),
                    }),
                    content: translateTravel(
                      '此成员将从所有用户的默认群移除，新用户也不再添加。原成员档案和历史消息保留，不会删除。',
                    ),
                    okText: translateTravel('确认删除成员'),
                    okButtonProps: { danger: true },
                    onOk: () => run(() => remove.mutateAsync({ key: member.key })),
                  })
                }
              >
                {translateTravel('删除')}
              </Button>
            </Flexbox>
          </Flexbox>
        ))}
        <AddMemberMenu
          card
          canManage={!busy}
          onAddFromList={() => {
            void candidates.refetch();
            candidateAnchor.current?.scrollIntoView({ block: 'nearest' });
            candidateAnchor.current?.querySelector('input')?.focus();
          }}
        />
      </div>
      <Flexbox gap={12} ref={candidateAnchor}>
        <Text as="h4" weight={600}>
          {translateTravel('添加已配置成员')}
        </Text>
        <Input
          aria-label={translateTravel('搜索已配置成员')}
          placeholder={translateTravel('搜索已配置成员')}
          style={{ fontSize: 16 }}
          suffix={<Search aria-hidden size={16} style={{ color: cssVar.colorTextTertiary }} />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Flexbox>
      {candidates.isError && (
        <Alert
          title={translateTravel('已有成员加载失败')}
          type="error"
          action={
            <Button onClick={() => void candidates.refetch()}>{translateTravel('重试')}</Button>
          }
        />
      )}
      {candidates.isLoading && <SkeletonBar height={80} />}
      <Flexbox gap={8} style={{ maxHeight: 260, overflowY: 'auto' }}>
        {(candidates.data ?? [])
          .filter((agent) => !members.some((member) => member.sourceAgentId === agent.id))
          .map((agent) => (
            <Flexbox horizontal align="center" gap={8} key={agent.id}>
              <Avatar avatar={agent.avatar || undefined} size={28} />
              <Text style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {agentDisplayName(agent, translateTravel('未命名成员'))}
              </Text>
              <Button
                disabled={busy}
                style={{ flexShrink: 0 }}
                onClick={() =>
                  sync(agent.id, agentDisplayName(agent, translateTravel('未命名成员')))
                }
              >
                {translateTravel('添加成员')}
              </Button>
              <Button
                danger
                disabled={busy}
                icon={<Trash2 size={16} />}
                style={{ flexShrink: 0 }}
                aria-label={translateTravel('删除 {{v0}}', {
                  v0: agentDisplayName(agent, translateTravel('未命名成员')),
                })}
                onClick={() =>
                  deleteCandidate(agent.id, agentDisplayName(agent, translateTravel('未命名成员')))
                }
              >
                {translateTravel('删除')}
              </Button>
            </Flexbox>
          ))}
      </Flexbox>
    </Flexbox>
  );
}

export default function SuperGroupTemplateSection(props: { onUpdated?: () => Promise<unknown> }) {
  const access = lambdaQuery.platformAccess.isPlatformAdmin.useQuery(undefined, { retry: false });
  if (access.isLoading || access.isError || access.data !== true) return null;
  return <MemberPublisher {...props} />;
}
