'use client';

import { type AgentGroupMember } from '@lobechat/types';
import { Flexbox, SortableList } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';

import MemberItem from './MemberItem';
import { useSortableMembers } from './useSortableMembers';

const styles = createStaticStyles(({ css, cssVar }) => ({
  item: css`
    height: 40px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};
    transition: background 0.2s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

interface SortMembersModalProps {
  groupId: string;
  onCancel: () => void;
  open: boolean;
}

/**
 * Drag-to-reorder the group's member roster. Persists on drop via
 * `reorderGroupMembers`, mirroring the session-group sort flow (ConfigGroupModal).
 */
const SortMembersModal = memo<SortMembersModalProps>(({ groupId, open, onCancel }) => {
  const { t } = useTranslation('chat');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const members = useAgentGroupStore(agentGroupSelectors.getGroupMembers(groupId), isEqual);
  const reorderGroupMembers = useAgentGroupStore((s) => s.reorderGroupMembers);

  const { list, setList } = useSortableMembers({ groupId, members, open });

  return (
    <ImperativeModal
      footer={null}
      open={open}
      title={t('groupSidebar.members.sortModalTitle')}
      width={400}
      onCancel={onCancel}
    >
      <Flexbox gap={2}>
        <SortableList
          items={list}
          renderItem={(item: AgentGroupMember) => (
            <SortableList.Item
              horizontal
              align={'center'}
              className={styles.item}
              gap={8}
              id={item.id}
            >
              <MemberItem
                avatar={item.avatar || undefined}
                background={item.backgroundColor ?? undefined}
                disabled={!canEdit}
                isExternal={!item.virtual}
                title={item.title || t('defaultSession', { ns: 'common' })}
              />
            </SortableList.Item>
          )}
          onChange={(next: AgentGroupMember[]) => {
            if (!canEdit) return;

            setList(next);
            reorderGroupMembers(
              groupId,
              next.map((member) => member.id),
            );
          }}
        />
      </Flexbox>
    </ImperativeModal>
  );
});

export default SortMembersModal;
