'use client';

import { ActionIcon, Button, createModal } from '@lobehub/ui/base-ui';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import MemberPanel from './MemberPanel';

export const GroupMembersButton = ({
  groupId,
  manageDefaultGroup = false,
  showLabel = false,
}: {
  groupId: string;
  manageDefaultGroup?: boolean;
  showLabel?: boolean;
}) => {
  const { t } = useTranslation('chat');
  const title = t('groupMembership.title', { defaultValue: 'Group members' });
  const openMembers = () =>
    createModal({
      content: <MemberPanel groupId={groupId} manageDefaultGroup={manageDefaultGroup} />,
      footer: null,
      title,
      width: 'min(560px, calc(100vw - 32px))',
    });
  if (showLabel)
    return (
      <Button
        icon={MoreHorizontal}
        style={{ width: '100%', justifyContent: 'flex-start', flexShrink: 0 }}
        type="text"
        onClick={openMembers}
      >
        {t('input.more', { defaultValue: 'More' })}
      </Button>
    );
  return (
    <ActionIcon
      aria-label={title}
      icon={MoreHorizontal}
      title={title}
      tooltipProps={{ placement: 'bottom' }}
      onClick={openMembers}
    />
  );
};
