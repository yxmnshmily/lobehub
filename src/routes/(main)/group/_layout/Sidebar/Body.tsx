'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { Accordion, Flexbox, Popover } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { MessageSquare, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import CompactListButton from '@/features/SuperGroup/CompactListButton';
import GroupSwitcher from '@/features/SuperGroup/GroupSwitcher';
import GroupTaskLink from '@/features/SuperGroup/GroupTaskLink';
import GroupWorkLinks from '@/features/SuperGroup/GroupWorkLinks';
import { SuperGroupSidebarBody } from '@/features/SuperGroup/JoinedGroupSidebar';
import { useMobileGroupSidebar } from '@/features/SuperGroup/useMobileGroupSidebar';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Nav from './Header/Nav';
import Members from './Members';
import Topic from './Topic';

const popupClassName = createStaticStyles(
  ({ css }) => css`
    overflow: hidden;
    box-sizing: border-box;
    width: max-content;
    max-width: min(300px, var(--available-width), calc(100vw - 88px));
  `,
);

export enum ChatSidebarKey {
  Members = 'members',
  Topic = 'topic',
}

const Body = () => {
  const { t } = useTranslation(['chat', 'topic']);
  const mobileSidebar = useMobileGroupSidebar();
  const expanded = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const compact = !!mobileSidebar || !expanded;
  const [floatingSection, setFloatingSection] = useState<ChatSidebarKey | null>(null);
  const activeGroupId = useAgentGroupStore((s) => s.activeGroupId);
  const defaultGroupId = useAgentGroupStore((state) => {
    const id = state.activeGroupId;
    const group = id ? state.groupMap[id] : undefined;
    return group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId
      ? id
      : undefined;
  });
  if (defaultGroupId)
    return (
      <SuperGroupSidebarBody manageDefaultGroup groupId={defaultGroupId} navigation={<Nav />} />
    );
  return (
    <Flexbox paddingInline={4}>
      <GroupSwitcher compact={compact}>
        <Nav />
        {compact ? (
          <Flexbox gap={8}>
            {[ChatSidebarKey.Members, ChatSidebarKey.Topic].map((section) => (
              <Popover
                nativeButton
                className={popupClassName}
                key={section}
                open={floatingSection === section}
                placement="rightTop"
                positionerProps={{ collisionPadding: 8, sideOffset: 8 }}
                trigger="click"
                content={
                  <Accordion
                    defaultExpandedKeys={[section]}
                    style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}
                  >
                    {section === ChatSidebarKey.Members ? (
                      <Members itemKey={section} />
                    ) : (
                      <Topic defaultExpanded itemKey={section} />
                    )}
                  </Accordion>
                }
                styles={{
                  content: {
                    width: '100%',
                    minWidth: 0,
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    maxHeight: 'min(600px, 75dvh)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: 8,
                  },
                }}
                onOpenChange={(open) =>
                  setFloatingSection((current) =>
                    open ? section : current === section ? null : current,
                  )
                }
              >
                <CompactListButton
                  icon={section === ChatSidebarKey.Members ? UserRound : MessageSquare}
                  title={
                    section === ChatSidebarKey.Members
                      ? t('groupSidebar.tabs.members', { ns: 'chat' })
                      : t('title', { ns: 'topic' })
                  }
                />
              </Popover>
            ))}
          </Flexbox>
        ) : (
          <Flexbox gap={8}>
            <div data-group-nav-branch="members">
              <Accordion defaultExpandedKeys={[]}>
                <Members itemKey={ChatSidebarKey.Members} />
              </Accordion>
            </div>
            <div data-group-nav-branch="">
              <Accordion defaultExpandedKeys={[]}>
                <Topic itemKey={ChatSidebarKey.Topic} />
              </Accordion>
            </div>
          </Flexbox>
        )}
        {activeGroupId && <GroupWorkLinks compact={compact} groupId={activeGroupId} />}
        <div data-group-nav-branch={compact ? undefined : ''}>
          <GroupTaskLink />
        </div>
      </GroupSwitcher>
    </Flexbox>
  );
};

export default Body;
