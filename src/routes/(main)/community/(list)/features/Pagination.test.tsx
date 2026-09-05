/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { DiscoverTab } from '@/types/discover';

import Pagination from './Pagination';

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ page: 'page' }),
  useResponsive: () => ({ mobile: true }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useQuery', () => ({ useQuery: () => ({}) }));

describe('community Pagination', () => {
  it('names the previous and next page buttons', () => {
    render(
      <MemoryRouter initialEntries={['/community/mcp']}>
        <Pagination currentPage={1} pageSize={20} tab={DiscoverTab.Mcp} total={40} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'next' })).toBeEnabled();
  });
});
