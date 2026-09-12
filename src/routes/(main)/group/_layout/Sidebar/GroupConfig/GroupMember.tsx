'use client';

import { agentDisplayName, DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
import AssistantActions from '@/features/GroupMembership/AssistantActions';
import AssistantMenu from '@/features/GroupMembership/AssistantMenu';
import { useMemberSidebar } from '@/features/GroupMembership/useMemberSidebar';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import UserAvatar from '@/features/User/UserAvatar';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { usePermission } from '@/hooks/usePermission';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import AddGroupMemberModal from '../AddGroupMemberModal';
import GroupMemberItem from './GroupMemberItem';
import { useRemoveGroupMember } from './useRemoveGroupMember';

const styles = createStaticStyles(({ css, cssVar }) => ({
  memberTrigger: css`
    box-sizing: border-box;
    overflow: hidden;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ${cssVar.motionEaseOut};

    &:hover,
    &:focus-visible,
    &[data-popup-open],
    &[data-active='true'] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface GroupMemberProps {
  addModalOpen: boolean;
  canManage: boolean;
  groupId?: string;
  onAddModalOpenChange: (open: boolean) => void;
}

/**
 * Group member info in Sidebar
 */
const GroupMember = memo<GroupMemberProps>(
  ({ addModalOpen, canManage, onAddModalOpenChange, groupId }) => {
    const { t } = useTranslation('chat');
    const { allowed: hasEditPermission } = usePermission('edit_own_content');
    const { canEditResource } = useResourceAccess('agentGroup', groupId);
    const canEdit = canManage && hasEditPermission && canEditResource;
    const router = useQueryRoute();
    const location = useActiveLocation();
    const [nickname, username] = useUserStore((s) => [
      userProfileSelectors.nickName(s),
      userProfileSelectors.username(s),
    ]);
    const addAgentsToGroup = useAgentGroupStore((s) => s.addAgentsToGroup);
    const removeAgentFromGroup = useAgentGroupStore((s) => s.removeAgentFromGroup);
    const { confirmRemoveMember, removingMemberIds } = useRemoveGroupMember({
      canEdit,
      groupId,
      removeAgentFromGroup,
      t,
    });

    const groupMembers = useAgentGroupStore(agentGroupSelectors.getGroupMembers(groupId || ''));
    const group = useAgentGroupStore((s) => (groupId ? s.groupMap[groupId] : undefined));
    const isSupergroup =
      group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId;
    const displayedMembers = isSupergroup ? (group?.agents ?? []) : groupMembers;
    const memberSidebar = useMemberSidebar();

    const activeTab = useMemo(
      () => new URLSearchParams(location.search).get('tab'),
      [location.search],
    );
    const isProfileRoute = useMemo(() => {
      if (!groupId) return false;
      return location.pathname === `/group/${groupId}/profile`;
    }, [groupId, location.pathname]);

    const handleAddMembers = async (selectedAgents: string[]) => {
      if (!canEdit) return;
      if (!groupId) {
        console.error('No active group to add members to');
        return;
      }

      if (selectedAgents.length > 0) {
        await addAgentsToGroup(groupId, selectedAgents);
      }

      onAddModalOpenChange(false);
    };

    const handleMemberDoubleClick = (agentId: string) => {
      if (!groupId || !canEdit) return;
      router.push(`/group/${groupId}/profile`, { query: { tab: agentId }, replace: true });
    };

    return (
      <>
        <Flexbox
          data-nav-scroll=""
          gap={2}
          style={{
            maxHeight: 'min(380px, 40dvh)',
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehavior: 'contain',
            flexShrink: 0,
            scrollbarWidth: 'thin',
          }}
        >
          {/* User */}
          {!isSupergroup && (
            <NavItem icon={<UserAvatar size={24} />} title={nickname || username || 'User'} />
          )}
          {groupId &&
            memberSidebar.arrange(displayedMembers).map((item) => {
              const memberTitle = agentDisplayName(item, t('defaultSession', { ns: 'common' }));

              return (
                <AgentProfilePopup agent={item} agentId={item.id} groupId={groupId} key={item.id}>
                  <div
                    className={styles.memberTrigger}
                    data-active={isProfileRoute && activeTab === item.id ? 'true' : undefined}
                    onDoubleClick={() => handleMemberDoubleClick(item.id)}
                  >
                    <GroupMemberItem
                      avatar={item.avatar || DEFAULT_AVATAR}
                      background={item.backgroundColor ?? undefined}
                      isExternal={!item.virtual}
                      title={memberTitle}
                      actions={
                        isSupergroup ? (
                          <AssistantActions
                            compact
                            agentId={item.id}
                            groupId={groupId}
                            isSupervisor={item.id === group?.supervisorAgentId}
                            pinned={item.pinned}
                            sessionGroupId={item.sessionGroupId}
                            title={memberTitle}
                            onUpdated={() =>
                              useAgentGroupStore.getState().refreshGroupDetail(groupId)
                            }
                          />
                        ) : canManage ? (
                          <AssistantMenu
                            compact
                            agentId={item.id}
                            canConfigure={canEdit}
                            pinned={item.pinned}
                            sessionGroupId={item.sessionGroupId}
                            title={memberTitle}
                            onRemove={
                              canEdit && !removingMemberIds.includes(item.id)
                                ? () => confirmRemoveMember(item.id, memberTitle)
                                : undefined
                            }
                            onUpdated={() =>
                              useAgentGroupStore.getState().refreshGroupDetail(groupId)
                            }
                          />
                        ) : undefined
                      }
                    />
                  </div>
                </AgentProfilePopup>
              );
            })}
        </Flexbox>

        {groupId && canManage && !isSupergroup && (
          <AddGroupMemberModal
            existingMembers={groupMembers.map((member) => member.id)}
            groupId={groupId}
            open={addModalOpen}
            onCancel={() => onAddModalOpenChange(false)}
            onConfirm={handleAddMembers}
          />
        )}
      </>
    );
  },
);

export default GroupMember;
