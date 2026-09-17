import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WorkRunControls from './WorkRunControls';

const mocks = vi.hoisted(() => ({
  allowed: true,
  pauseGoal: vi.fn(),
  resumeGoal: vi.fn(),
  cancelGoal: vi.fn(),
  updateTaskStatus: vi.fn(),
  resumeTask: vi.fn(),
  cancelTask: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: mocks.allowed }) }));
vi.mock('@/store/goal', () => ({ useGoalStore: (select: any) => select(mocks) }));
vi.mock('@/store/task', () => ({ useTaskStore: (select: any) => select(mocks) }));
vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, loading, danger, size, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  toast: { error: mocks.error },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
});

describe('manual work controls', () => {
  it('lets the user pause or cancel a goal awaiting review', async () => {
    render(<WorkRunControls id="g" kind="goals" status="review" />);
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(mocks.pauseGoal).toHaveBeenCalledWith('g'));
    await waitFor(() => expect(screen.getByRole('button', { name: '取消目标' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '取消目标' }));
    await waitFor(() => expect(mocks.cancelGoal).toHaveBeenCalledWith('g'));
  });
  it('resumes a paused task using its stored scheduling policy', async () => {
    render(<WorkRunControls id="t" kind="tasks" status="paused" />);
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(mocks.resumeTask).toHaveBeenCalledWith('t'));
  });
  it('cancels scheduled tasks through the cascade action and refreshes the caller', async () => {
    const changed = vi.fn();
    render(<WorkRunControls id="t" kind="tasks" status="scheduled" onChanged={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
    await waitFor(() => expect(mocks.cancelTask).toHaveBeenCalledWith('t'));
    expect(changed).toHaveBeenCalledOnce();
  });
  it('retains an actionable error and re-enables controls if stopping fails', async () => {
    mocks.pauseGoal.mockRejectedValueOnce(new Error('offline'));
    render(<WorkRunControls id="g" kind="goals" status="planning" />);
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled();
  });
  it('does not expose actions without edit permission or for canceled work', () => {
    mocks.allowed = false;
    const view = render(<WorkRunControls id="g" kind="goals" status="running" />);
    expect(screen.queryByRole('button')).toBeNull();
    mocks.allowed = true;
    view.rerender(<WorkRunControls id="g" kind="goals" status="canceled" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
