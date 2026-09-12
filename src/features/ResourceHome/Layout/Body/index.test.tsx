import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Body from './index';

const mocks = vi.hoisted(() => ({ expanded: false, open: vi.fn(), navigate: vi.fn() }));
vi.mock('@/features/LibraryModal', () => ({ useCreateNewModal: () => ({ open: mocks.open }) }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => mocks.expanded }));
vi.mock('./LibraryList', () => ({ default: () => <div>My library</div> }));

describe('library sidebar compact list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides library rows until the shared icon trigger opens, and retains creation', async () => {
    render(<Body itemKey="library" />);
    expect(screen.queryByText('My library')).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'library.title' });
    expect(trigger.querySelector('[data-nav-chevron]')).not.toBeNull();
    fireEvent.click(trigger);
    expect(await screen.findByText('My library')).toBeInTheDocument();
    fireEvent.click(screen.getByText('library.new'));
    expect(mocks.open).toHaveBeenCalledOnce();
  });
});
