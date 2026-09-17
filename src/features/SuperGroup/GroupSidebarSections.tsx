'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { Accordion, AccordionItem, Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Alert, Avatar, Button, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { ArrowRight, ChevronDown, MessageSquare, UserRound } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { isDesktop } from '@/const/version';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import { GroupMembersButton } from '@/features/GroupMembership';
import AssistantActions from '@/features/GroupMembership/AssistantActions';
import DefaultGroupActions from '@/features/GroupMembership/DefaultGroupActions';
import { useMemberSidebar } from '@/features/GroupMembership/useMemberSidebar';
import CompactListPopover from '@/features/NavPanel/components/CompactListPopover';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaQuery } from '@/libs/trpc/client';
import { useGlobalStore } from '@/store/global';

import CompactListButton from './CompactListButton';
import GroupWorkLinks from './GroupWorkLinks';
import RecentTopicLinks from './RecentTopicLinks';

export default function GroupSidebarSections({
  groupId,
  onSelectTopic,
  manageDefaultGroup = false,
  navigation,
  compact = false,
}: {
  groupId: string;
  onSelectTopic?: (id: string, messageId?: string) => void;
  manageDefaultGroup?: boolean;
  navigation?: ReactNode;
  compact?: boolean;
}) {
  const router = useQueryRoute();
  const { pathname } = useActiveLocation();
  const membersPath = `${GROUP_CHAT_URL(groupId)}/members`;
  const membersActive = pathname === membersPath || pathname.startsWith(`${membersPath}/`);
  const [membersExpanded, setMembersExpanded] = useState(compact);
  const participants = lambdaQuery.groupMembership.listParticipants.useQuery(
    { groupId, limit: 50, offset: 0 },
    { gcTime: 0, refetchOnWindowFocus: true, retry: false },
  );
  const assistants = participants.data?.assistants ?? [];
  const memberSidebar = useMemberSidebar();
  const people = participants.data?.items ?? [];
  const memberCount = people.length + assistants.length;
  // Older running servers omit totalCount; a completed page still gives an exact total.
  const totalMemberCount =
    participants.data?.totalCount != null
      ? participants.data.totalCount + assistants.length
      : participants.data && participants.data.nextOffset == null
        ? memberCount
        : undefined;
  const visiblePeople = people.slice(0, 10);
  const visibleAssistants = memberSidebar
    .arrange(assistants)
    .slice(0, Math.max(0, 10 - visiblePeople.length));
  const hasMore = memberCount > 10 || participants.data?.nextOffset != null;
  const openMembers = () => {
    router.push(`${GROUP_CHAT_URL(groupId)}/members`);
    useGlobalStore.getState().toggleMobileTopic(false);
  };
  const members = !isDesktop ? (
    <Button
      aria-label="成员"
      className="group-nav-section-header"
      type="text"
      style={{
        width: '100%',
        minWidth: 0,
        height: 'var(--group-nav-row-height, 44px)',
        paddingInline: 4,
        gap: 8,
        justifyContent: 'flex-start',
      }}
      onClick={openMembers}
    >
      <span
        className="group-nav-section-icon"
        style={{ display: 'inline-flex', justifyContent: 'center', width: 28, flexShrink: 0 }}
      >
        <UserRound aria-hidden size={20} />
      </span>
      <Text data-nav-label="" fontSize={12} type="secondary">
        成员
        {totalMemberCount != null && (
          <span style={{ color: cssVar.colorError }}>（{totalMemberCount}）</span>
        )}
      </Text>
      <ArrowRight
        aria-hidden
        color={membersActive ? cssVar.colorText : cssVar.colorTextQuaternary}
        data-nav-expanded-only=""
        size={16}
        style={{ marginInlineStart: 'auto', flexShrink: 0 }}
      />
    </Button>
  ) : (
    <AccordionItem
      hideIndicator
      expand={membersExpanded}
      itemKey="members"
      paddingBlock={4}
      paddingInline={4}
      styles={{ header: { minHeight: 'var(--group-nav-row-height, 44px)' } }}
      action={
        <Flexbox horizontal align="center">
          <DefaultGroupActions groupId={groupId} />
          <GroupMembersButton groupId={groupId} manageDefaultGroup={manageDefaultGroup} />
        </Flexbox>
      }
      classNames={{
        header: 'group-nav-section-header',
        indicator: 'group-nav-section-indicator',
      }}
      title={
        <Flexbox horizontal align="center" gap={4}>
          <Button
            aria-label="成员"
            style={{ padding: 0, gap: 8, minWidth: 0, height: 28, background: 'transparent' }}
            type="text"
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              router.push(`${GROUP_CHAT_URL(groupId)}/members`);
              useGlobalStore.getState().toggleMobileTopic(false);
            }}
          >
            <span className="group-nav-section-icon">
              <Icon icon={UserRound} size={20} />
            </span>
            <Text fontSize={12} type="secondary">
              成员
              {totalMemberCount != null && (
                <span style={{ color: cssVar.colorError }}>（{totalMemberCount}）</span>
              )}
            </Text>
            <ArrowRight
              aria-hidden
              color={membersActive ? cssVar.colorText : cssVar.colorTextQuaternary}
              data-nav-expanded-only=""
              size={16}
            />
          </Button>
          <ActionIcon
            aria-expanded={membersExpanded}
            aria-label={membersExpanded ? '收起成员' : '展开成员'}
            icon={ChevronDown}
            size="small"
            style={{ transform: membersExpanded ? 'rotate(180deg)' : undefined }}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setMembersExpanded(!membersExpanded);
            }}
          />
        </Flexbox>
      }
      onExpandChange={setMembersExpanded}
    >
      {participants.isLoading ? (
        <SkeletonList rows={3} />
      ) : participants.isError ? (
        <Alert
          action={<Button onClick={() => void participants.refetch()}>重试</Button>}
          title="成员加载失败"
          type="error"
        />
      ) : (
        <Flexbox data-group-member-preview="" gap={2} style={{ minWidth: 0 }}>
          {visiblePeople.map((person) => (
            <Flexbox
              horizontal
              align="center"
              gap={8}
              key={person.memberUserId}
              padding={8}
              style={{ minWidth: 0 }}
            >
              <Avatar
                avatar={person.avatar || undefined}
                size={24}
                title={person.displayName || '成员'}
              />
              <Text ellipsis title={person.displayName || '成员'}>
                {person.displayName || '成员'}
              </Text>
              {person.role === 'owner' && (
                <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
                  群主
                </Text>
              )}
              {person.role === 'member' && (
                <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
                  访客
                </Text>
              )}
            </Flexbox>
          ))}
          {visibleAssistants.map((agent) => (
            <Flexbox horizontal align="center" key={agent.id} style={{ minWidth: 0 }}>
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
                <Button
                  aria-label={agent.title || '成员'}
                  type="text"
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    minWidth: 0,
                    justifyContent: 'flex-start',
                    padding: 8,
                    gap: 8,
                  }}
                >
                  <Avatar avatar={agent.avatar || '🤖'} size={24} />
                  <Text ellipsis title={agent.title || '成员'}>
                    {agent.title || '成员'}
                  </Text>
                  {agent.subtitle && (
                    <Text ellipsis fontSize={12} title={agent.subtitle} type="secondary">
                      {agent.subtitle}
                    </Text>
                  )}
                  {agent.isSupervisor && (
                    <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
                      主管
                    </Text>
                  )}
                  {memberSidebar.category(agent.id, agent.sessionGroupId) && (
                    <Text ellipsis fontSize={12} type="secondary">
                      {memberSidebar.category(agent.id, agent.sessionGroupId)}
                    </Text>
                  )}
                </Button>
              </AgentProfilePopup>
              {manageDefaultGroup && (
                <AssistantActions
                  compact
                  agentId={agent.id}
                  groupId={groupId}
                  isSupervisor={agent.isSupervisor}
                  pinned={agent.pinned}
                  sessionGroupId={agent.sessionGroupId}
                  title={agent.title || '成员'}
                  onUpdated={() => participants.refetch()}
                />
              )}
            </Flexbox>
          ))}
          {hasMore && (
            <GroupMembersButton
              showLabel
              groupId={groupId}
              manageDefaultGroup={manageDefaultGroup}
            />
          )}
          {!memberCount && <Text type="secondary">暂无成员</Text>}
        </Flexbox>
      )}
    </AccordionItem>
  );
  const topics = (
    <RecentTopicLinks
      collapsible={isDesktop}
      defaultExpanded={compact}
      groupId={groupId}
      scrollWithinSection={false}
      onSelectTopic={onSelectTopic}
    />
  );
  if (compact)
    return (
      <Flexbox gap={8}>
        {!isDesktop ? (
          <CompactListButton
            icon={UserRound}
            showChevron={false}
            title="成员"
            onClick={openMembers}
          />
        ) : (
          [{ key: 'members', title: '成员', icon: UserRound, content: members }].map((section) => (
            <CompactListPopover icon={section.icon} key={section.key} title={section.title}>
              <Accordion defaultExpandedKeys={[section.key]}>{section.content}</Accordion>
            </CompactListPopover>
          ))
        )}
        <CompactListButton
          icon={MessageSquare}
          title="话题"
          onClick={() => {
            router.push(`${GROUP_CHAT_URL(groupId)}/topics`);
            useGlobalStore.getState().toggleMobileTopic(false);
          }}
        />
        <GroupWorkLinks compact groupId={groupId} />
      </Flexbox>
    );
  return (
    <Flexbox gap="var(--group-nav-gap, 8px)" style={{ minWidth: 0, width: '100%' }}>
      {navigation}
      <div data-group-nav-branch="members">
        {isDesktop ? <Accordion defaultExpandedKeys={[]}>{members}</Accordion> : members}
      </div>
      <div data-group-nav-branch="">
        <Accordion defaultExpandedKeys={[]}>{topics}</Accordion>
      </div>
      <GroupWorkLinks groupId={groupId} />
    </Flexbox>
  );
}
