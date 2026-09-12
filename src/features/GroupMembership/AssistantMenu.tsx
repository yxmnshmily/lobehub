'use client';

import { Input, type MenuProps } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  createModal,
  DropdownMenu,
  ModalFooter,
  toast,
  useModalContext,
} from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Ellipsis, Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentDropdownMenu } from '@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu';
import { openCreateGroupModal } from '@/features/HomeSidebar/Body/Agent/Modals/CreateGroupModal';
import { useSidebarItemVisibility } from '@/features/HomeSidebar/Body/Agent/useSidebarItemVisibility';
import { useFetchAgentLabels } from '@/hooks/useFetchAgentLabels';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { agentService } from '@/services/agent';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

export function RenameMember({
  agentId,
  title,
  onUpdated,
}: {
  agentId: string;
  title: string;
  onUpdated: () => Promise<unknown>;
}) {
  const { close } = useModalContext();
  const [name, setName] = useState(title);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    try {
      // A member's name is distinct from its professional role (title).
      await agentService.updateAgentConfig(agentId, { name: name.trim() });
      await Promise.all([onUpdated(), useHomeStore.getState().refreshAgentList()]);
      close();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重命名失败，请重试');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Input
        autoFocus
        aria-label="成员姓名"
        disabled={saving}
        value={name}
        onChange={(event) => setName(event.target.value)}
        onPressEnter={() => void save()}
      />
      <ModalFooter>
        <Button onClick={close}>取消</Button>
        <Button disabled={!name.trim()} loading={saving} type="primary" onClick={() => void save()}>
          保存
        </Button>
      </ModalFooter>
    </>
  );
}

/** Reuse list operations, but retain each group's own membership-removal policy. */
export default function AssistantMenu({
  agentId,
  canConfigure,
  canRename = true,
  compact = false,
  onRemove,
  onUpdated,
  onNavigate,
  title,
  pinned,
  sessionGroupId,
}: {
  agentId: string;
  canConfigure: boolean;
  canRename?: boolean;
  compact?: boolean;
  onRemove?: () => void;
  onUpdated: () => Promise<unknown>;
  onNavigate?: () => void;
  title: string;
  pinned?: boolean | null;
  sessionGroupId?: string | null;
}) {
  const { t } = useTranslation('common');
  useFetchAgentLabels();
  useFetchAgentList();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const item = useHomeStore(homeAgentListSelectors.getAgentById(agentId));
  const group = useHomeStore(
    (s) =>
      [...s.agentGroups, ...s.privateAgentGroups].find((entry) =>
        entry.items.some((agent) => agent.id === agentId),
      )?.id,
  );
  const { isSidebarItemVisible, setSidebarItemVisible } = useSidebarItemVisibility();
  const visible = isSidebarItemVisible({ id: agentId, type: 'agent' });
  const getMenu = useAgentDropdownMenu({
    anchor,
    avatar: typeof item?.avatar === 'string' ? item.avatar : undefined,
    group: sessionGroupId ?? group ?? 'default',
    id: agentId,
    labels: item?.labels,
    labelsEnabled: canConfigure,
    openCreateGroupModal: () => {
      openCreateGroupModal({ id: agentId, visibility: item?.visibility, onCreated: onUpdated });
    },
    pinned: pinned ?? item?.pinned ?? false,
    title,
    userId: item?.userId,
    visibility: item?.visibility,
  });
  const menu = (): MenuProps['items'] => {
    const items: NonNullable<MenuProps['items']> = (getMenu() ?? [])
      .filter(
        (entry) =>
          entry &&
          [
            'hideFromSidebar',
            'openInNewWindow',
            ...(canConfigure
              ? [
                  'pin',
                  'manage',
                  ...(canRename ? ['rename'] : []),
                  'duplicate',
                  'moveGroup',
                  'labels',
                ]
              : []),
          ].includes(String(entry.key)),
      )
      .map((entry) => {
        if (entry?.key === 'pin' && 'onClick' in entry)
          return {
            ...entry,
            onClick: async (event: any) => {
              try {
                await entry.onClick?.(event);
                await onUpdated();
              } catch {
                toast.error(t('operationFailed'));
              }
            },
          };
        if (entry?.key === 'moveGroup' && 'children' in entry)
          return {
            ...entry,
            children: entry.children?.map((child) => {
              if (!child || !('onClick' in child) || child.key === 'createGroup') return child;
              return {
                ...child,
                onClick: async (event: any) => {
                  try {
                    await child.onClick?.(event);
                    await onUpdated();
                  } catch {
                    toast.error(t('operationFailed'));
                  }
                },
              };
            }),
          };
        if (entry?.key === 'manage' && 'onClick' in entry)
          return {
            ...entry,
            onClick: (event: any) => {
              entry.onClick?.(event);
              onNavigate?.();
            },
          };
        if (entry?.key !== 'rename') return entry;
        return {
          ...entry,
          onClick: () =>
            createModal({
              title: '重命名成员',
              content: <RenameMember agentId={agentId} title={title} onUpdated={onUpdated} />,
              footer: null,
            }),
        };
      });
    if (!visible)
      items.splice(1, 0, {
        key: 'showInSidebar',
        label: t('agentViewAll.addToSidebar'),
        onClick: async () => {
          try {
            await setSidebarItemVisible(agentId, true);
          } catch {
            toast.error(t('operationFailed'));
          }
        },
      });
    const result: NonNullable<MenuProps['items']> = [];
    for (const entry of items) {
      if (entry?.key === 'manage' || (!canConfigure && entry?.key === 'duplicate'))
        result.push({ type: 'divider' });
      result.push(entry);
    }
    if (canConfigure && onRemove)
      result.push(
        { type: 'divider' },
        {
          danger: true,
          icon: <Trash size={16} />,
          key: 'delete',
          label: t('delete'),
          onClick: onRemove,
        },
      );
    return result;
  };
  return (
    <span
      ref={setAnchor}
      style={{ alignItems: 'center', display: 'inline-flex', flex: 'none' }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <DropdownMenu items={menu}>
        {compact ? (
          <ActionIcon
            aria-label={`${t('more')} ${title}`}
            icon={Ellipsis}
            size="small"
            title={t('more')}
          />
        ) : (
          <Button
            aria-label={`${t('more')} ${title}`}
            style={{
              border: `0.5px solid ${cssVar.colorBorder}`,
              borderRadius: cssVar.borderRadius,
              boxSizing: 'border-box',
              minHeight: 44,
              paddingInline: 15,
              whiteSpace: 'nowrap',
            }}
          >
            {t('more')}
          </Button>
        )}
      </DropdownMenu>
    </span>
  );
}
