'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { MessageSquarePlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

const Nav = memo(() => {
  const { t: tTopic } = useTranslation('topic');
  const switchToNewTopic = useAgentGroupStore((s) => s.switchToNewTopic);
  const params = useActiveRouteParams();
  const groupId = params.gid;
  const group = useAgentGroupStore(agentGroupSelectors.getGroupById(groupId ?? ''));
  const isDefaultSupergroup =
    group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID && !group.workspaceId;

  if (isDefaultSupergroup) return null;

  return (
    <Flexbox data-group-nav-branches="" gap={1} paddingInline={4}>
      {!isDefaultSupergroup && (
        <div data-group-nav-branch="">
          <NavItem
            icon={MessageSquarePlusIcon}
            title={tTopic('actions.addNewTopic')}
            onClick={switchToNewTopic}
          />
        </div>
      )}
    </Flexbox>
  );
});

export default Nav;
