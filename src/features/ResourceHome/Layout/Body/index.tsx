import { AccordionItem, Flexbox, Tooltip } from '@lobehub/ui';
import { ActionIcon, Text } from '@lobehub/ui/base-ui';
import { LibraryBig, PlusIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateNewModal } from '@/features/LibraryModal';
import CompactListPopover from '@/features/NavPanel/components/CompactListPopover';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import LibraryList from './LibraryList';

const SidebarBody = memo<{ itemKey: string }>(({ itemKey }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();

  const { open } = useCreateNewModal();
  const { allowed: canCreate, reason } = usePermission('create_content');
  const expanded = useGlobalStore(systemStatusSelectors.showLeftPanel);

  const handleCreate = () => {
    if (!canCreate) return;
    open({
      onSuccess: (id) => {
        navigate(`/resource/library/${id}`);
      },
    });
  };

  const createButton = (
    <ActionIcon
      disabled={!canCreate}
      icon={PlusIcon}
      size={'small'}
      title={canCreate ? t('library.new') : undefined}
      onClick={handleCreate}
    />
  );

  if (!expanded) {
    return (
      <CompactListPopover icon={LibraryBig} title={t('library.title')}>
        <Flexbox gap={4}>
          <NavItem
            disabled={!canCreate}
            icon={PlusIcon}
            title={t('library.new')}
            onClick={handleCreate}
          />
          <LibraryList />
        </Flexbox>
      </CompactListPopover>
    );
  }

  return (
    <AccordionItem
      action={canCreate ? createButton : <Tooltip title={reason}>{createButton}</Tooltip>}
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
          {t('library.title')}
        </Text>
      }
    >
      <LibraryList />
    </AccordionItem>
  );
});

export default SidebarBody;
