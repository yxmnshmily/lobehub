'use client';

import { Flexbox } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import ImperativeModal from '@/components/ImperativeModal';
import InvitationForm from '@/features/GroupMembership/InvitationForm';
import { groupKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';

import { type AgentItemData } from './AgentItem';
import AvailableAgentList from './AvailableAgentList';
import SelectedAgentList from './SelectedAgentList';
import { useAgentSelectionStore } from './store';
import { submitSelectedAgents } from './submitSelectedAgents';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: row;

    height: 500px;
    padding: 12px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius}px;
  `,
  rightColumn: css`
    display: flex;
    flex: 1;
    flex-direction: column;
  `,
}));

export interface AddGroupMemberModalProps {
  existingMembers?: string[];
  groupId: string;
  onCancel: () => void;
  onConfirm: (selectedAgents: string[]) => void | Promise<void>;
  open: boolean;
}

const AddGroupMemberModal = memo<AddGroupMemberModalProps>(
  ({ existingMembers = [], groupId, onCancel, onConfirm, open }) => {
    const { t } = useTranslation(['chat', 'common']);

    const selectedAgentIds = useAgentSelectionStore((s) => s.selectedAgentIds);
    const beginSelection = useAgentSelectionStore((s) => s.beginSelection);
    const clearSelection = useAgentSelectionStore((s) => s.clearSelection);

    // Fetch agents from the new API (non-virtual agents only)
    const { data: allAgents = [], isLoading: isLoadingAgents } = useSWR(
      open ? groupKeys.queryAgents() : null,
      () => agentService.queryAgents(),
    );

    // Filter out existing members
    const availableAgents = useMemo<AgentItemData[]>(() => {
      return allAgents.filter((agent) => !existingMembers.includes(agent.id));
    }, [allAgents, existingMembers]);

    // Selection is modal- and group-scoped. Reusing the open modal for another
    // group must never carry the first group's candidates into the new target.
    useEffect(() => {
      if (open) beginSelection(groupId);
      else clearSelection();
    }, [beginSelection, clearSelection, groupId, open]);

    const [isAdding, setIsAdding] = useState(false);

    const handleConfirm = async () => {
      try {
        setIsAdding(true);
        await submitSelectedAgents({
          clearSelection,
          errorMessage: t('operationFailed', { ns: 'common' }),
          notifyError: toast.error,
          onConfirm,
          selectedAgentIds,
        });
      } finally {
        setIsAdding(false);
      }
    };

    const handleCancel = () => {
      clearSelection();
      onCancel();
    };

    const isConfirmDisabled = selectedAgentIds.length === 0 || isAdding;

    return (
      <ImperativeModal
        allowFullscreen
        okButtonProps={{ disabled: isConfirmDisabled, loading: isAdding }}
        okText={`${t('memberSelection.addMember')} (${selectedAgentIds.length})`}
        open={open}
        title={t('memberSelection.addMember')}
        width={800}
        onCancel={handleCancel}
        onOk={handleConfirm}
      >
        <Flexbox gap={16}>
          <InvitationForm disabled={isAdding} groupId={groupId} />
          <Flexbox horizontal className={styles.container} gap={8}>
            {/* Left Column - Available Agents */}
            <AvailableAgentList agents={availableAgents} isLoading={isLoadingAgents} />

            <Divider orientation={'vertical'} style={{ height: '100%' }} />

            {/* Right Column - Selected Agents */}
            <SelectedAgentList agents={allAgents} />
          </Flexbox>
        </Flexbox>
      </ImperativeModal>
    );
  },
);

export default AddGroupMemberModal;
