import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import GroupWorkLinks from './GroupWorkLinks';
import { useGroupWorkRequest } from './useGroupWorkRequest';

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
  expect(push).toHaveBeenCalledWith('/group/current/goals');
  fireEvent.click(screen.getByRole('button', { name: '任务' }));
  expect(push).toHaveBeenCalledWith('/group/current/tasks');
  expect(useGroupWorkRequest.getState().request).toBeNull();
});

it('navigates to the requested group with no inherited topic query', () => {
  window.history.replaceState({}, '', '/group/old?topic=old-topic');
  render(<GroupWorkLinks groupId="next" />);
  fireEvent.click(screen.getByRole('button', { name: '任务' }));
  expect(push).toHaveBeenCalledWith('/group/next/tasks');
  expect(useGroupWorkRequest.getState().request).toBeNull();
});
