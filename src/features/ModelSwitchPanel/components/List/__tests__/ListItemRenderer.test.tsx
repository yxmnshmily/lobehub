// @vitest-environment happy-dom
import {
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ListItemRenderer } from '../ListItemRenderer';

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => undefined,
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/store/user', () => ({ useUserStore: () => false }));
vi.mock('@/components/ModelSelect', () => ({
  ModelItemRender: ({ displayName }: any) => <span>{displayName}</span>,
  ProviderItemRender: () => null,
}));
vi.mock('../../ModelDetailPanel', () => ({ default: () => null }));
it('commits a model row after a real mouse pointer click', async () => {
  const change = vi.fn(),
    close = vi.fn();
  render(
    <DropdownMenuRoot>
      <DropdownMenuTrigger>
        <button>models</button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuPositioner>
          <DropdownMenuPopup>
            <ListItemRenderer
              activeKey="old"
              newLabel="new"
              item={
                {
                  type: 'provider-model-item',
                  provider: { id: 'test' },
                  model: { id: 'new-model', displayName: 'New model' },
                } as any
              }
              onClose={close}
              onModelChange={change}
            />
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenuRoot>,
  );
  fireEvent.click(screen.getByText('models'));
  const row = await screen.findByText('New model');
  fireEvent.pointerDown(row, { pointerType: 'mouse', button: 0 });
  fireEvent.mouseDown(row, { button: 0 });
  fireEvent.mouseUp(row, { button: 0 });
  fireEvent.click(row, { button: 0 });
  await waitFor(() => expect(change).toHaveBeenCalledWith('new-model', 'test'));
  expect(close).toHaveBeenCalledOnce();
});
