import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GroupWorkEntry from './GroupWorkEntry';

describe('group work edge entry', () => {
  it('keeps running work visible when collapsed and opens only the selected item', () => {
    const open = vi.fn();
    render(
      <GroupWorkEntry
        onSelect={() => {}}
        onOpen={open}
        items={[
          {
            id: 'goal-1',
            kind: 'goals',
            title: '账号策划',
            assigneeLabel: '主管',
            status: '等待确认',
            isRunning: false,
          },
          {
            id: 'task-1',
            kind: 'tasks',
            title: '整理同行资料',
            assigneeLabel: '研究成员',
            status: '执行中',
            isRunning: true,
          },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: '目标与任务' });
    expect(screen.getByText('目标 1')).toBeInTheDocument();
    expect(screen.getByText('任务 1')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('执行中 1');
    expect(screen.queryByRole('button', { name: /整理同行资料/ })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /整理同行资料/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }));
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.getByRole('status')).toHaveTextContent('执行中 1');
    expect(screen.queryByRole('button', { name: /整理同行资料/ })).not.toBeInTheDocument();
  });

  it('does not describe paused or waiting work as executing', () => {
    render(
      <GroupWorkEntry
        onSelect={() => {}}
        items={[
          {
            id: 'task-2',
            kind: 'tasks',
            title: '封面设计',
            assigneeLabel: '设计成员',
            status: '已暂停',
            isRunning: false,
          },
        ]}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('待处理 1');
    expect(screen.getByRole('status')).not.toHaveTextContent('执行中');
  });
  it('grows the existing controls instead of replacing the compact labels with another panel', () => {
    render(<GroupWorkEntry onSelect={() => {}} />);
    const goal = screen.getByRole('button', { name: '设定一个目标' });
    const task = screen.getByRole('button', { name: '制定一个任务' });
    const trigger = screen.getByRole('button', { name: '目标与任务' });
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.getByRole('button', { name: '设定一个目标' })).toBe(goal);
    expect(screen.getByRole('button', { name: '制定一个任务' })).toBe(task);
  });
  it('reveals on mouse entry and keeps controls accessible while moving inside', () => {
    render(<GroupWorkEntry onSelect={() => {}} />);
    const trigger = screen.getByRole('button', { name: '目标与任务' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const goal = screen.getByRole('button', { name: '设定一个目标' });
    fireEvent.mouseEnter(goal);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.mouseLeave(trigger.parentElement!);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports touch/click expansion and only opens the selected destination', () => {
    const select = vi.fn();
    render(<GroupWorkEntry onSelect={select} />);
    const trigger = screen.getByRole('button', { name: '目标与任务' });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '制定一个任务' }));
    expect(select).toHaveBeenCalledWith('tasks', expect.any(HTMLButtonElement));
  });

  it('opens for keyboard focus and Escape collapses with focus returned to the edge', () => {
    render(<GroupWorkEntry onSelect={() => {}} />);
    const trigger = screen.getByRole('button', { name: '目标与任务' });
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const goal = screen.getByRole('button', { name: '设定一个目标' });
    fireEvent.keyDown(goal, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });
});
