// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskCallbackMessage from './index';

let groupId: string | undefined;
let item: any;
const openTaskDetail = vi.fn();
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector({ openTaskDetail }),
}));
vi.mock('../../store', () => ({
  dataSelectors: { getDisplayMessageById: () => () => item },
  useConversationStore: (selector: any) => selector({ context: { groupId } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  groupId = 'group';
  item = {
    content: 'Complete handoff and unique deliverable',
    metadata: { taskCallback: { identifier: 'T-29', reason: 'done', taskId: 'task-id' } },
  };
});

describe('TaskCallbackMessage', () => {
  it('keeps the group task entry visible while allowing the complete result to expand', () => {
    render(<TaskCallbackMessage id="callback" index={0} />);
    expect(screen.getByText('taskCallback.done')).toBeTruthy();
    expect(screen.getByText('T-29')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'taskCallback.viewTask' }));
    expect(openTaskDetail).toHaveBeenCalledWith('T-29');
    const details = screen.getByRole('button', { name: 'groupProcess.details' });
    expect(details.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(item.content)).toBeTruthy();
    fireEvent.click(details);
    expect(details.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'taskCallback.viewTask' })).toBeTruthy();
  });

  it('preserves direct callback content outside groups', () => {
    groupId = undefined;
    render(<TaskCallbackMessage id="callback" index={0} />);
    expect(screen.getByText(item.content)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'groupProcess.details' })).toBeNull();
  });

  it.each(['error', 'interrupted'])('always displays the %s status and task entry', (reason) => {
    item.metadata.taskCallback.reason = reason;
    render(<TaskCallbackMessage id="callback" index={0} />);
    expect(screen.getByText(`taskCallback.${reason}`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'taskCallback.viewTask' }));
    expect(openTaskDetail).toHaveBeenCalledWith('T-29');
  });

  it('keeps a task entry even without callback text', () => {
    item.content = '';
    render(<TaskCallbackMessage id="callback" index={0} />);
    expect(screen.getByRole('button', { name: 'taskCallback.viewTask' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'groupProcess.details' })).toBeNull();
  });
});
