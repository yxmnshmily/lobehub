'use client';

import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  resolveAgentGroupManagementPolicy,
} from '@lobechat/types';
import { AccordionItem, Flexbox } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { ArrowUpDown, Loader2Icon, UserPlus, UserRound } from 'lucide-react';
import { type MouseEvent } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DefaultGroupActions from '@/features/GroupMembership/DefaultGroupActions';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useInitGroupConfig } from '@/hooks/useInitGroupConfig';
import { usePermission } from '@/hooks/usePermission';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import GroupMember from '../GroupConfig/GroupMember';
import SortMembersModal from '../GroupConfig/SortMembersModal';

interface MembersProps {
  itemKey: string;
  onOpen?: () => void;
}

const Members = memo<MembersProps>(({ itemKey, onOpen }) => {
  const { t } = useTranslation('chat');
  const { allowed: hasEditPermission, reason } = usePermission('edit_own_content');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);

  const activeGroupId = useAgentGroupStore(agentGroupSelectors.activeGroupId);
  const { canEditResource } = useResourceAccess('agentGroup', activeGroupId);
  const group = useAgentGroupStore(agentGroupSelectors.getGroupById(activeGroupId ?? ''));
  const { data: isPlatformAdmin } = lambdaQuery.platformAccess.isPlatformAdmin.useQuery();
  const isDefaultSupergroup =
    group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId;
  const canManageGroup =
    !!group &&
    !isDefaultSupergroup &&
    (resolveAgentGroupManagementPolicy(group.clientId) !== 'platform' || isPlatformAdmin === true);
  const canEdit = hasEditPermission && canEditResource && canManageGroup;
  const membersCount = useAgentGroupStore(
    agentGroupSelectors.getGroupAgentCount(activeGroupId || ''),
  );
  const memberCount = useAgentGroupStore(
    agentGroupSelectors.getGroupMemberCount(activeGroupId || ''),
  );
  const { isRevalidating } = useInitGroupConfig();

  const handleAddMember = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;

    setAddModalOpen(true);
  };

  const handleSortMember = (e: MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;

    setSortModalOpen(true);
  };

  return (
    <AccordionItem
      classNames={{ header: 'group-nav-section-header', indicator: 'group-nav-section-indicator' }}
      expand={onOpen ? false : undefined}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={4}
      styles={{ header: { minHeight: 36 } }}
      action={
        !onOpen && (
          <Flexbox horizontal align="center" data-nav-expanded-only="">
            {isRevalidating && <ActionIcon loading icon={Loader2Icon} size={'small'} />}
            {isDefaultSupergroup && activeGroupId && (
              <DefaultGroupActions groupId={activeGroupId} />
            )}
            {canManageGroup && memberCount > 1 && (
              <ActionIcon
                disabled={!canEdit}
                icon={ArrowUpDown}
                size={'small'}
                title={canEdit ? t('groupSidebar.members.sortMember') : reason}
                onClick={handleSortMember}
              />
            )}
            {canManageGroup && (
              <ActionIcon
                disabled={!canEdit}
                icon={UserPlus}
                size={'small'}
                title={canEdit ? t('groupSidebar.members.addMember') : reason}
                onClick={handleAddMember}
              />
            )}
          </Flexbox>
        )
      }
      title={
        <Flexbox
          horizontal
          align="center"
          data-nav-section-title=""
          gap={8}
          title={t('groupSidebar.tabs.members')}
        >
          <span
            className="group-nav-section-icon"
            style={{ display: 'inline-flex', justifyContent: 'center', width: 28, flexShrink: 0 }}
          >
            <UserRound aria-hidden size={18} />
          </span>
          <Text ellipsis data-nav-label="" fontSize={12} type={'secondary'} weight={500}>
            {`${t('groupSidebar.tabs.members')} ${membersCount}`}
          </Text>
        </Flexbox>
      }
      onExpandChange={onOpen}
    >
      <Flexbox gap={1} paddingBlock={1}>
        <GroupMember
          addModalOpen={addModalOpen}
          canManage={canManageGroup}
          groupId={activeGroupId}
          onAddModalOpenChange={setAddModalOpen}
        />
      </Flexbox>
      {activeGroupId && canManageGroup && (
        <SortMembersModal
          groupId={activeGroupId}
          open={sortModalOpen}
          onCancel={() => setSortModalOpen(false)}
        />
      )}
    </AccordionItem>
  );
});

export default Members;
