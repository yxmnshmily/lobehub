'use client';

import type { ComponentProps } from 'react';

import { NavPanelPortal } from '@/features/NavPanel/NavPanelPortal';
import SideBarLayout from '@/features/NavPanel/SideBarLayout';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import GroupSidebarHeader from './GroupSidebarHeader';
import GroupSidebarSections from './GroupSidebarSections';
import GroupSwitcher from './GroupSwitcher';
import { useMobileGroupSidebar } from './useMobileGroupSidebar';

export function SuperGroupSidebarBody(props: ComponentProps<typeof GroupSidebarSections>) {
  const mobileSidebar = useMobileGroupSidebar();
  const expanded = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const compact = !!mobileSidebar || !expanded;
  return (
    <div style={{ paddingInline: 4 }}>
      <GroupSwitcher compact={compact} sectionGroupId={props.groupId}>
        <GroupSidebarSections {...props} compact={compact} />
      </GroupSwitcher>
    </div>
  );
}

export default function JoinedGroupSidebar(props: {
  groupId: string;
  onSelectTopic?: (id: string, messageId?: string) => void;
}) {
  const router = useQueryRoute();
  return (
    <NavPanelPortal navKey="group">
      <SideBarLayout
        body={
          <SuperGroupSidebarBody
            {...props}
            onSelectTopic={
              props.onSelectTopic ??
              ((id, messageId) =>
                router.push(
                  `/group/${props.groupId}/${id}${messageId ? `#${encodeURIComponent(messageId)}` : ''}`,
                ))
            }
          />
        }
        header={
          <GroupSidebarHeader
            groupId={props.groupId}
            onHome={() => router.push(`/group/${props.groupId}`)}
          />
        }
      />
    </NavPanelPortal>
  );
}
