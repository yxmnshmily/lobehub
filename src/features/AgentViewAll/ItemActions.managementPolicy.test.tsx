/**
 * @vitest-environment happy-dom
 */
import type { SidebarAgentItem } from '@lobechat/types';
import type { MenuProps } from '@lobehub/ui';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import ItemActions from './ItemActions';

vi.mock('@lobehub/ui', () => ({ Icon: () => null }));

vi.mock('@lobehub/ui/base-ui', () => ({
  ActionIcon: () => null,
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  confirmModal: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/business/client/hooks/useAgentGroupTransferMenuItem', () => ({
  useAgentGroupTransferMenuItem: () => null,
}));

vi.mock('@/business/client/hooks/useAgentGroupTransferToMemberMenuItem', () => ({
  useAgentGroupTransferToMemberMenuItem: () => null,
}));

vi.mock('@/features/EditingPopover/store', () => ({ openEditingPopover: vi.fn() }));

vi.mock('@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu', () => ({
  useAgentDropdownMenu: () => () => [],
}));

vi.mock('@/features/HomeSidebar/Body/Agent/ModalProvider', () => ({
  useAgentModal: () => ({ openCreateGroupModal: vi.fn() }),
}));

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({ canEditResource: true, isAccessResolved: true }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: {
      isPlatformAdmin: { useQuery: () => ({ data: false }) },
    },
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { openAgentInNewWindow: typeof vi.fn }) => unknown) =>
    selector({ openAgentInNewWindow: vi.fn() }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      duplicateAgentGroup: vi.fn(),
      pinAgentGroup: vi.fn(),
      removeAgentGroup: vi.fn(),
    }),
}));

const getMenuKeys = (items: MenuProps['items']) =>
  (items ?? []).flatMap((item) =>
    item && typeof item === 'object' && 'key' in item && item.key ? [item.key] : [],
  );

describe('AgentViewAll group management policy', () => {
  it('keeps the platform-managed policy when adapting the shared group menu', () => {
    let getItems: (() => MenuProps['items']) | undefined;
    const item: SidebarAgentItem = {
      id: 'group-1',
      managementPolicy: 'platform',
      pinned: false,
      title: 'Travel group',
      type: 'group',
      updatedAt: new Date(),
    };

    render(
      <ItemActions
        forceActivated
        hideTrigger
        anchor={null}
        item={item}
        onMenuReady={(menu) => {
          getItems = menu;
        }}
      />,
    );

    expect(getMenuKeys(getItems?.())).toEqual(['openInNewWindow']);
  });
});
