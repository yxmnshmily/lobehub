import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { openInboxModal } from './index';

const state = vi.hoisted(() => ({
  close: vi.fn(),
  navigate: vi.fn(),
  modal: vi.fn(),
}));
vi.mock('@lobehub/ui/base-ui', () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return {
    ActionIcon: () => null,
    Button: Box,
    createModal: state.modal,
    DropdownMenu: ({ items }: any) => (
      <>
        {items.map((item: any) => (
          <button disabled={item.disabled} key={item.key} onClick={item.onClick}>
            {item.label}
          </button>
        ))}
      </>
    ),
    ModalClose: () => null,
    ModalHeader: Box,
    ModalTitle: Box,
    Tabs: () => null,
    Text: Box,
    toast: { error: vi.fn() },
    useModalContext: () => ({ close: state.close }),
  };
});
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => state.navigate,
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: () => ({ data: [], isLoading: false, mutate: vi.fn() }),
}));
vi.mock('@/libs/next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/features/NavPanel/components/NavItem', () => ({ default: () => null }));
vi.mock('@/features/ResourceTransferRequest', () => ({ PENDING_TRANSFERS_SWR_KEY: 'transfers' }));
vi.mock('@/services/notification', () => ({ notificationService: {} }));
vi.mock('@/services/resourceTransferRequest', () => ({ resourceTransferRequestService: {} }));

it('opens notification settings from the inbox and closes the covering modal', () => {
  openInboxModal();
  render(state.modal.mock.calls[0][0].content);
  fireEvent.click(screen.getByRole('button', { name: '通知设置' }));
  expect(state.close).toHaveBeenCalledOnce();
  expect(state.navigate).toHaveBeenCalledWith('/settings/notification');
  expect(state.close.mock.invocationCallOrder[0]).toBeLessThan(
    state.navigate.mock.invocationCallOrder[0],
  );
});
