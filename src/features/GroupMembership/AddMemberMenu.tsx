'use client';

import { Button, createModal, DropdownMenu, useModalContext } from '@lobehub/ui/base-ui';
import { Bot, ChevronDown, ListPlus, Plus, Store, UserPlus } from 'lucide-react';
import type { ComponentProps } from 'react';

import { AgentModalProvider, useAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { GroupLinkPanel } from './GroupShareButton';

function AddMemberMenuContent({
  canManage,
  groupId,
  onAddFromList,
  showLabel = false,
  card = false,
}: {
  canManage: boolean;
  groupId?: string;
  onAddFromList: () => unknown;
  showLabel?: boolean;
  card?: boolean;
}) {
  const { openCreateModal } = useAgentModal();
  const navigate = useWorkspaceAwareNavigate();
  const { close } = useModalContext();
  return (
    <DropdownMenu
      items={[
        {
          key: 'create-agent',
          label: '创建助理',
          icon: <Bot size={18} />,
          disabled: !canManage,
          onClick: () => {
            if (canManage) openCreateModal('agent');
          },
        },
        {
          key: 'from-list',
          label: '从助理列表添加',
          icon: <ListPlus size={18} />,
          disabled: !canManage,
          onClick: () => {
            if (canManage) onAddFromList();
          },
        },
        {
          key: 'from-market',
          label: '从市场添加助理',
          icon: <Store size={18} />,
          disabled: !canManage,
          onClick: () => {
            if (canManage) {
              close();
              navigate('/community/agent');
            }
          },
        },
        ...(groupId
          ? [
              {
                key: 'invite-person',
                label: '邀请真人成员',
                icon: <UserPlus size={18} />,
                disabled: !canManage,
                onClick: () => {
                  if (!canManage) return;
                  createModal({
                    title: '邀请真人成员',
                    content: <GroupLinkPanel groupId={groupId} />,
                    footer: null,
                    width: 'min(480px, calc(100vw - 32px))',
                  });
                },
              },
            ]
          : []),
      ]}
    >
      <Button
        aria-label={card ? '添加成员菜单' : '添加成员'}
        disabled={!canManage}
        icon={Plus}
        title={canManage ? '添加成员' : '由管理员统一添加成员'}
        style={
          card
            ? {
                width: '100%',
                height: '100%',
                minHeight: 104,
                borderStyle: 'dashed',
                flexDirection: 'column',
                gap: 8,
              }
            : undefined
        }
      >
        {(showLabel || card) && <span>添加成员</span>}
        {!card && <ChevronDown size={14} />}
      </Button>
    </DropdownMenu>
  );
}

export default function AddMemberMenu(props: ComponentProps<typeof AddMemberMenuContent>) {
  return (
    <AgentModalProvider>
      <AddMemberMenuContent {...props} />
    </AgentModalProvider>
  );
}
