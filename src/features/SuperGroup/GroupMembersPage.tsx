'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';
import { Flexbox, SearchBar } from '@lobehub/ui';
import { ActionIcon, Alert, Avatar, Button, Tag, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Eye, EyeOff, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import MembersSkeleton from '@/components/Skeleton/Members';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { agentRowStyles } from '@/features/AgentViewAll/AgentRow';
import ListConfig from '@/features/AgentViewAll/ListConfig';
import { DEFAULT_AGENT_LIST_VIEW_OPTIONS } from '@/features/AgentViewAll/listViewOptions';
import SidebarAgentsSection, {
  sidebarSectionStyles,
} from '@/features/AgentViewAll/SidebarAgentsSection';
import { GroupMembersButton } from '@/features/GroupMembership';
import AssistantActions from '@/features/GroupMembership/AssistantActions';
import DefaultGroupActions from '@/features/GroupMembership/DefaultGroupActions';
import { useMemberSidebar } from '@/features/GroupMembership/useMemberSidebar';
import { useSidebarItemVisibility } from '@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility';
import NavHeader from '@/features/NavHeader';
import { useMobileGroupSidebar } from '@/features/SuperGroup/useMobileGroupSidebar';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';

import { getGroupMemberSections } from './groupMembersView';

export default function GroupMembersPage() {
  const { gid = '' } = useParams<{ gid: string }>();
  return <GroupMembers groupId={gid} key={gid} />;
}

export function GroupMembers({ groupId }: { groupId: string }) {
  const router = useQueryRoute();
  const mobileSidebar = useMobileGroupSidebar();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [viewOptions, setViewOptions] = useState(DEFAULT_AGENT_LIST_VIEW_OPTIONS);
  const query = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId, limit: 50, offset },
    { enabled: !!groupId, gcTime: 0, refetchOnWindowFocus: true, retry: false },
  );
  const sidebar = useMemberSidebar();
  const { isSidebarItemVisible, setSidebarItemVisible } = useSidebarItemVisibility();
  // Access failures must never leave the previously cached member list visible.
  const data = query.isError ? undefined : query.data;
  const agents = data?.assistants ?? [];
  const keyword = search.trim().toLocaleLowerCase();
  const matches = (...values: (string | null | undefined)[]) =>
    values.join(' ').toLocaleLowerCase().includes(keyword);
  const filtered = agents.filter(
    (agent) =>
      matches(agent.title, agent.subtitle, agent.description) &&
      (viewOptions.showSidebarHidden || isSidebarItemVisible({ id: agent.id, type: 'agent' })),
  );
  const sections = getGroupMemberSections(filtered, viewOptions);
  const people = (data?.items ?? []).filter((person) => matches(person.displayName));
  const visible = sidebar.arrange(agents);
  const cards: SidebarAgentItem[] = visible.map((agent) => ({
    id: agent.id,
    avatar: agent.avatar,
    name: agent.title,
    title: agent.subtitle ?? null,
    description: agent.description,
    type: 'agent',
    pinned: !!agent.pinned,
    updatedAt: agent.updatedAt,
  }));
  const identity = (agent: (typeof agents)[number], card = false) => (
    <AgentProfilePopup
      nativeButton
      agentId={agent.id}
      groupId={groupId}
      agent={{
        avatar: agent.avatar ?? undefined,
        name: agent.title ?? undefined,
        title: agent.subtitle ?? agent.title ?? undefined,
        description: agent.description ?? undefined,
        model: agent.model ?? undefined,
        provider: agent.provider ?? undefined,
      }}
    >
      {card ? (
        <Button
          aria-label={agent.title || '未命名成员'}
          className={sidebarSectionStyles.card}
          style={{ width: '100%', height: '100%', textAlign: 'start' }}
        >
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
            <Avatar avatar={agent.avatar || '🤖'} size={24} />
            <Text ellipsis weight={600}>
              {agent.title || '未命名成员'}
            </Text>
            {agent.subtitle && <Tag size="small">{agent.subtitle}</Tag>}
          </Flexbox>
          {agent.description && (
            <Text className={sidebarSectionStyles.description} fontSize={12} type="secondary">
              {agent.description}
            </Text>
          )}
        </Button>
      ) : (
        <Button
          aria-label={agent.title || '未命名成员'}
          type="text"
          style={{
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: '100%',
            justifyContent: 'flex-start',
            paddingInline: 0,
            gap: 12,
          }}
        >
          <Avatar avatar={agent.avatar || '🤖'} size={28} />
          <Text ellipsis weight={500}>
            {agent.title || '未命名成员'}
          </Text>
          {agent.subtitle && <Tag size="small">{agent.subtitle}</Tag>}
        </Button>
      )}
    </AgentProfilePopup>
  );
  return (
    <Flexbox flex={1} height="100%" style={{ minHeight: 0, minWidth: 0 }}>
      <NavHeader
        showTogglePanelButton={!mobileSidebar}
        left={
          <Flexbox horizontal align="center" gap={8}>
            {mobileSidebar && (
              <ActionIcon
                aria-expanded={mobileSidebar.open}
                aria-label={mobileSidebar.open ? '收起侧栏' : '展开侧栏'}
                icon={mobileSidebar.open ? PanelLeftClose : PanelLeftOpen}
                style={{ height: 44, width: 44 }}
                title={mobileSidebar.open ? '收起侧栏' : '展开侧栏'}
                onClick={mobileSidebar.toggle}
              />
            )}
            <Button type="text" onClick={() => router.push(GROUP_CHAT_URL(groupId))}>
              群主页
            </Button>
            <Text type="secondary">›</Text>
            <Text weight={500}>成员</Text>
          </Flexbox>
        }
        right={
          <ListConfig
            options={viewOptions}
            setOptions={setViewOptions}
            setViewMode={setViewMode}
            viewMode={viewMode}
          />
        }
      />
      <WideScreenContainer
        fullWidth
        gap={16}
        paddingBlock={16}
        paddingInline={16}
        wrapperStyle={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {query.isLoading ? (
          <MembersSkeleton chrome={'body'} />
        ) : !data ? (
          <Alert
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
            title="成员加载失败"
            type="error"
          />
        ) : (
          <>
            {!keyword && cards.length > 0 && (
              <SidebarAgentsSection
                items={cards}
                renderItem={(item) =>
                  identity(
                    agents.find((agent) => agent.id === item.id)!,
                    true,
                  )
                }
              />
            )}
            <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
              <SearchBar
                allowClear
                aria-label="搜索成员"
                placeholder="搜索成员…"
                style={{ maxWidth: 240 }}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Flexbox horizontal align="center" gap={4}>
                <DefaultGroupActions
                  addAsMenu
                  groupId={groupId}
                  onUpdated={() => query.refetch()}
                />
                <GroupMembersButton manageDefaultGroup groupId={groupId} />
              </Flexbox>
            </Flexbox>
            <Flexbox gap={16}>
              {sections.map((section) => (
                <Flexbox gap={8} key={section.label}>
                  {viewOptions.groupBy === 'label' && (
                    <Text weight={600}>{section.label || '无标签'}</Text>
                  )}
                  <Flexbox
                    className={viewMode === 'card' ? sidebarSectionStyles.grid : undefined}
                    gap={4}
                    style={viewMode === 'card' ? { display: 'grid', gap: 12 } : undefined}
                  >
                    {section.items.map((agent) => {
                      const shown = isSidebarItemVisible({ id: agent.id, type: 'agent' });
                      return (
                        <Flexbox
                          align={viewMode === 'list' ? 'center' : 'stretch'}
                          gap={12}
                          horizontal={viewMode === 'list'}
                          key={agent.id}
                          className={
                            viewMode === 'card' ? sidebarSectionStyles.card : agentRowStyles.row
                          }
                          style={{
                            minWidth: 0,
                            ...(viewMode === 'card'
                              ? {
                                  border: `0.5px solid ${cssVar.colorBorderSecondary}`,
                                  borderRadius: 12,
                                }
                              : {}),
                          }}
                        >
                          {identity(agent)}
                          {viewMode === 'card' && agent.description && (
                            <Text ellipsis type="secondary">
                              {agent.description}
                            </Text>
                          )}
                          <Flexbox
                            horizontal
                            align="center"
                            gap={4}
                            justify="flex-end"
                            style={{ marginInlineStart: 'auto' }}
                          >
                            <ActionIcon
                              aria-label={`${shown ? '从侧边栏隐藏' : '在侧边栏显示'} ${agent.title}`}
                              color={cssVar.colorTextSecondary}
                              icon={shown ? Eye : EyeOff}
                              size="small"
                              title={shown ? '从侧边栏隐藏' : '在侧边栏显示'}
                              onClick={() =>
                                void setSidebarItemVisible(agent.id, !shown).catch(() =>
                                  toast.error('侧边栏设置保存失败，请重试'),
                                )
                              }
                            />
                            <AssistantActions
                              compact
                              agentId={agent.id}
                              groupId={groupId}
                              isSupervisor={agent.isSupervisor}
                              pinned={agent.pinned}
                              sessionGroupId={agent.sessionGroupId}
                              title={agent.title || '成员'}
                              onUpdated={() => query.refetch()}
                            />
                          </Flexbox>
                        </Flexbox>
                      );
                    })}
                  </Flexbox>
                </Flexbox>
              ))}
              {people.map((person) => (
                <Flexbox
                  horizontal
                  align="center"
                  className={agentRowStyles.row}
                  gap={12}
                  key={person.memberUserId}
                >
                  <Avatar avatar={person.avatar || undefined} size={28} />
                  <Text>{person.displayName || '成员'}</Text>
                  <Tag size="small">{person.role === 'owner' ? '群主' : '访客'}</Tag>
                </Flexbox>
              ))}
              {!filtered.length && !people.length && <Text type="secondary">没有匹配的成员</Text>}
            </Flexbox>
            {(offset > 0 || data.nextOffset != null) && (
              <Flexbox horizontal gap={8}>
                <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
                  上一页访客
                </Button>
                <Button
                  disabled={data.nextOffset == null}
                  onClick={() => setOffset(data.nextOffset ?? offset)}
                >
                  下一页访客
                </Button>
              </Flexbox>
            )}
          </>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
}
