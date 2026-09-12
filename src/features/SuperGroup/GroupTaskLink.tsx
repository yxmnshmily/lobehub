'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import GroupLogs from './GroupLogs';

export { default as GroupLogs } from './GroupLogs';

export default function GroupTaskLink({ groupId }: { groupId?: string }) {
  const { t } = useTranslation('common');
  if (!groupId)
    return (
      <WorkspaceLink to="/tasks">
        <NavItem icon={ListChecks} title={t('tab.tasks')} />
      </WorkspaceLink>
    );
  return (
    <NavItem
      icon={ListChecks}
      title="群日志"
      onClick={() => {
        const modal = createModal({
          title: '群日志',
          width: 900,
          footer: null,
          content: <GroupLogs groupId={groupId} onNavigate={() => modal.close()} />,
        });
      }}
    />
  );
}
