/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGroupDropdownMenu } from './useDropdownMenu';

const mocks = vi.hoisted(() => ({
  canEditResource: true,
  canManage: true,
  isPlatformAdmin: false,
  home: {
    duplicateAgentGroup: vi.fn(),
    pinAgentGroup: vi.fn(),
    removeAgentGroup: vi.fn(),
  },
  openAgentInNewWindow: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({ Icon: () => null }));

vi.mock('@lobehub/ui/base-ui', () => ({
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

vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => ({
    canEditResource: mocks.canEditResource,
    isAccessResolved: true,
  }),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/hooks/useResourceManageable', () => ({
  useResourceManageable: () => mocks.canManage,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    platformAccess: {
      isPlatformAdmin: {
        useQuery: () => ({ data: mocks.isPlatformAdmin }),
      },
    },
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { openAgentInNewWindow: typeof vi.fn }) => unknown) =>
    selector({ openAgentInNewWindow: mocks.openAgentInNewWindow }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: typeof mocks.home) => unknown) => selector(mocks.home),
}));

const getMenuKeys = (items: ReturnType<ReturnType<typeof useGroupDropdownMenu>>) =>
  (items ?? []).flatMap((item) =>
    item && typeof item === 'object' && 'key' in item && item.key ? [item.key] : [],
  );

const renderMenu = (managementPolicy: 'platform' | 'user') =>
  renderHook(() =>
    useGroupDropdownMenu({
      anchor: null,
      id: 'group-1',
      managementPolicy,
      pinned: false,
      title: 'Group',
      userId: 'owner-1',
    }),
  );

describe('useGroupDropdownMenu management policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canEditResource = true;
    mocks.canManage = true;
    mocks.isPlatformAdmin = false;
  });

  it('hides platform-managed group mutations from an ordinary user', () => {
    const { result } = renderMenu('platform');

    expect(getMenuKeys(result.current())).toEqual(['openInNewWindow']);
  });

  it('keeps ordinary user-created group mutations unchanged', () => {
    const { result } = renderMenu('user');

    expect(getMenuKeys(result.current())).toEqual([
      'pin',
      'rename',
      'duplicate',
      'openInNewWindow',
      'delete',
    ]);
  });

  it('keeps platform-managed group mutations available to a super admin', () => {
    mocks.isPlatformAdmin = true;
    const { result } = renderMenu('platform');

    expect(getMenuKeys(result.current())).toEqual([
      'pin',
      'rename',
      'duplicate',
      'openInNewWindow',
      'delete',
    ]);
  });
});
