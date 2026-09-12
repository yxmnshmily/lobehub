/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeBaseItem from './index';

const knowledgeBaseState = vi.hoisted(() => ({
  knowledgeBaseLoadingIds: [] as string[],
  knowledgeBaseRenamingId: null as string | null,
  updateKnowledgeBase: vi.fn(),
}));
const toggleLeftPanel = vi.hoisted(() => vi.fn());
vi.mock('@/store/global', () => ({
  useGlobalStore: Object.assign(() => undefined, { getState: () => ({ toggleLeftPanel }) }),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));

vi.mock('@/components/LibIcon', () => ({
  default: () => <span data-testid="repo-icon" />,
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    actions,
    title,
    onDoubleClick,
  }: {
    actions?: ReactNode;
    title: ReactNode;
    onDoubleClick?: React.MouseEventHandler;
  }) => (
    <div data-testid="nav-item" onDoubleClick={onDoubleClick}>
      <span data-testid="nav-title">{title}</span>
      {actions}
    </div>
  ),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('@/features/NavPanel/OverlayContainer', () => ({
  useOverlayPopoverPortalProps: () => undefined,
}));

vi.mock('@/features/ResourceManager/store', () => ({
  useResourceManagerStore: (selector: (state: { setLibraryId: () => void }) => unknown) =>
    selector({ setLibraryId: vi.fn() }),
}));

vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(knowledgeBaseState),
    { setState: vi.fn() },
  ),
}));

vi.mock('./Actions', () => ({
  default: () => <div data-testid="actions" />,
}));

vi.mock('./useDropdownMenu', () => ({
  useDropdownMenu: () => [],
}));

describe('KnowledgeBaseItem', () => {
  beforeEach(() => {
    knowledgeBaseState.knowledgeBaseLoadingIds = [];
    knowledgeBaseState.knowledgeBaseRenamingId = null;
    knowledgeBaseState.updateKnowledgeBase.mockReset();
    toggleLeftPanel.mockClear();
  });

  it('opens the sidebar before beginning inline rename from an icon row', () => {
    render(<KnowledgeBaseItem id="kb-1" name="My Library" />);
    fireEvent.doubleClick(screen.getByTestId('nav-item'), { altKey: true });
    expect(toggleLeftPanel).toHaveBeenCalledWith(true);
  });

  it('keeps the visible row and rename anchor inside one list child', () => {
    const { container } = render(<KnowledgeBaseItem id="kb-1" name="My Library" />);

    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).toContainElement(screen.getByTestId('nav-item'));
  });

  it('renders the rename input inside the row title while editing', () => {
    knowledgeBaseState.knowledgeBaseRenamingId = 'kb-1';

    render(<KnowledgeBaseItem id="kb-1" name="My Library" />);

    expect(within(screen.getByTestId('nav-title')).getByRole('textbox')).toHaveValue('My Library');
  });
});
