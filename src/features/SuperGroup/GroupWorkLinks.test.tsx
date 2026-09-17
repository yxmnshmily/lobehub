import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import GroupWorkLinks from './GroupWorkLinks';
import { useGroupWorkRequest } from './useGroupWorkRequest';

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    goal: { list: { useQuery: () => ({ data: { total: 104, goals: [{}] } }) } },
    task: { list: { useQuery: () => ({ data: { total: 205, data: [{}] } }) } },
  },
}));
vi.mock('@/store/project', () => ({
  useProjectStore: (selector: any) =>
    selector({
      useFetchProjectList: () => ({ data: { data: Array.from({ length: 106 }) } }),
    }),
}));
it('shows exact totals instead of the limited preview lengths', () => {
  render(<GroupWorkLinks groupId="current" />);
  expect(screen.getByText('（104）')).toBeInTheDocument();
  expect(screen.getByText('（205）')).toBeInTheDocument();
  expect(screen.getByText('（106）')).toBeInTheDocument();
});

const push = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useLocation: () => ({ pathname: window.location.pathname }),
}));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push }) }));
afterEach(() => {
  push.mockClear();
  useGroupWorkRequest.setState({ request: null });
  window.history.replaceState({}, '', '/');
});

it.each([false, true])(
  'opens projects below tasks inside the selected group (compact=%s)',
  (compact) => {
    render(<GroupWorkLinks compact={compact} groupId="current" />);
    const projects = screen.getByRole('button', { name: '项目' });
    expect(
      screen.getByRole('button', { name: '任务' }).compareDocumentPosition(projects) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(projects);
    expect(push).toHaveBeenCalledWith('/group/current/projects', { replace: true });
    expect(useGroupWorkRequest.getState().request).toBeNull();
  },
);

it.each([false, true])('opens durable group-scoped list routes (compact=%s)', (compact) => {
  window.history.replaceState({}, '', '/group/current');
  render(<GroupWorkLinks compact={compact} groupId="current" />);
  fireEvent.click(screen.getByRole('button', { name: '目标' }));
  expect(push).toHaveBeenCalledWith('/group/current/goals', { replace: true });
  fireEvent.click(screen.getByRole('button', { name: '任务' }));
  expect(push).toHaveBeenCalledWith('/group/current/tasks', { replace: true });
  expect(useGroupWorkRequest.getState().request).toBeNull();
});

it('navigates to the requested group with no inherited topic query', () => {
  window.history.replaceState(
    {},
    '',
    '/group/old?topic=old-topic&view=history&collection=scheduled',
  );
  render(<GroupWorkLinks groupId="next" />);
  fireEvent.click(screen.getByRole('button', { name: '任务' }));
  expect(push).toHaveBeenCalledWith('/group/next/tasks', { replace: true });
  expect(useGroupWorkRequest.getState().request).toBeNull();
});
