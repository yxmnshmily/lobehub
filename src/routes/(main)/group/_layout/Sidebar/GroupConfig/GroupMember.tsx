'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { UserMinus } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_AVATAR } from '@/const/meta';
import AgentProfilePopup from '@/features/AgentProfileCard/AgentProfilePopup';
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
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ${cssVar.motionEaseOut};

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
    const { allowed: hasEditPermission, reason } = usePermission('edit_own_content');
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
        <Flexbox gap={2}>
          {/* User */}
          <NavItem icon={<UserAvatar size={24} />} title={nickname || username || 'User'} />
          {groupId &&
            groupMembers.map((item) => {
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
                        canManage ? (
                          <ActionIcon
                            danger
                            disabled={!canEdit}
                            icon={UserMinus}
                            loading={removingMemberIds.includes(item.id)}
                            size={'small'}
                            title={canEdit ? t('groupSidebar.members.removeMember') : reason}
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmRemoveMember(item.id, memberTitle);
                            }}
                          />
                        ) : undefined
                      }
                    />
                  </div>
                </AgentProfilePopup>
              );
            })}
        </Flexbox>

        {groupId && canManage && (
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
