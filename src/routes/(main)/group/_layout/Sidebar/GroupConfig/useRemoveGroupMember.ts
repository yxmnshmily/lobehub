import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { type TFunction } from 'i18next';
import { useState } from 'react';

interface UseRemoveGroupMemberOptions {
  canEdit: boolean;
  groupId?: string;
  notifyError?: (message: string) => void;
  removeAgentFromGroup: (groupId: string, memberId: string) => Promise<void>;
  requestConfirmation?: typeof confirmModal;
  t: TFunction<'chat'>;
}

export const useRemoveGroupMember = ({
  canEdit,
  groupId,
  notifyError = toast.error,
  removeAgentFromGroup,
  requestConfirmation = confirmModal,
  t,
}: UseRemoveGroupMemberOptions) => {
  const [removingMemberIds, setRemovingMemberIds] = useState<string[]>([]);

  const confirmRemoveMember = (memberId: string, memberTitle: string) => {
    if (!canEdit || !groupId) return;

    requestConfirmation({
      cancelText: t('cancel', { ns: 'common' }),
      content: `${t('group.removeMember')}: ${memberTitle}`,
      okButtonProps: { danger: true },
      okText: t('group.removeMember'),
      onOk: async () => {
        setRemovingMemberIds((previous) =>
          previous.includes(memberId) ? previous : [...previous, memberId],
        );
        try {
          await removeAgentFromGroup(groupId, memberId);
        } catch {
          notifyError(t('operationFailed', { ns: 'common' }));
        } finally {
          setRemovingMemberIds((previous) => previous.filter((id) => id !== memberId));
        }
      },
      title: t('groupSidebar.members.removeMember'),
    });
  };

  return { confirmRemoveMember, removingMemberIds };
};
