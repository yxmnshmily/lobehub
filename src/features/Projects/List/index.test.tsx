import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { GroupProjectScopeContext } from '../Layout/GroupProjectScope';
import ProjectListPage from './index';

vi.mock('@/store/user', () => ({ useUserStore: () => false }));
vi.mock('@/store/project', () => ({
  useCurrentProjectList: () => [],
  useProjectStore: (selector: any) =>
    selector({ useFetchProjectList: () => ({ isLoading: false, mutate: vi.fn() }) }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

it('offers the group project list without requiring the standalone labs switch', () => {
  render(
    <GroupProjectScopeContext value={{ groupId: 'g1' }}>
      <ProjectListPage />
    </GroupProjectScopeContext>,
  );
  expect(screen.getByRole('button', { name: 'create.action' })).toBeVisible();
});
