import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import AcceptanceWorkspace from './index';

vi.mock('../hooks', () => ({
  useAcceptanceList: (_enabled: boolean, options: { projectId?: string }) => ({
    data: options.projectId ? [] : [{ id: 'a1' }],
    isLoading: false,
  }),
}));
vi.mock('./AcceptanceListPanel', () => ({ default: () => null }));
vi.mock('./AcceptanceOnboarding', () => ({ default: () => null }));
vi.mock('./AcceptanceProjectActions', () => ({ useAcceptanceProjectActionItems: () => [] }));
vi.mock('./useReportPanelExpand', () => ({
  useReportPanelExpand: () => ({ expand: true, isNarrow: false, setExpand: vi.fn() }),
}));
vi.mock('@/features/RouteMeta', () => ({ RouteMetaBridge: () => null }));

const open = (path: string, projectId?: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AcceptanceWorkspace projectId={projectId} />} path="/acceptance">
          <Route index element={<div>请选择一条验收</div>} />
          <Route element={<div>验收结果和证据</div>} path=":acceptanceId" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('project acceptance layout', () => {
  it('does not spend a second pane on an unselected project detail', () => {
    open('/acceptance', 'p1');
    expect(screen.queryByText('请选择一条验收')).not.toBeInTheDocument();
  });
  it('keeps a deep-linked project report accessible even when the list is empty', () => {
    open('/acceptance/a1', 'p1');
    expect(screen.getByText('验收结果和证据')).toBeVisible();
  });
  it('preserves the standalone workspace placeholder', () => {
    open('/acceptance');
    expect(screen.getByText('请选择一条验收')).toBeVisible();
  });
});
