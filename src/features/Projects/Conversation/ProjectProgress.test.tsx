import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProjectDetail } from '@/store/project';

import ProjectProgress from './ProjectProgress';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));

const detail = {
  project: { id: 'p1', slug: 'trip', identifier: 'TRIP' },
  agents: [{ agent: { id: 'a1', title: '文案成员' } }],
  works: [],
  tasks: [
    { id: 't1', identifier: 'TRIP-1', name: '整理资料', status: 'completed' },
    { id: 't2', identifier: 'TRIP-2', name: '制作文案', status: 'running', assigneeAgentId: 'a1' },
    { id: 't3', identifier: 'TRIP-3', name: '废弃方案', status: 'canceled' },
    { id: 't4', identifier: 'TRIP-4', name: '审核图片', status: 'failed' },
  ],
} as unknown as ProjectDetail;

describe('project conversation progress', () => {
  it('shows real task states and assignees without counting cancellation as completion', () => {
    render(<ProjectProgress detail={detail} />);
    expect(screen.getByText('已完成 1 / 3')).toBeVisible();
    expect(screen.getByText('制作文案')).toBeVisible();
    expect(screen.getByText('文案成员')).toBeVisible();
    expect(screen.getByText('执行失败')).toBeVisible();
    expect(screen.getByText('已取消')).not.toBeVisible();
    fireEvent.click(screen.getByText('制作文案'));
    expect(navigate).toHaveBeenCalledWith('/task/TRIP-2');
  });
  it('keeps finished tasks accessible without crowding active work', () => {
    render(<ProjectProgress detail={detail} />);
    expect(screen.getByText('整理资料')).not.toBeVisible();
    fireEvent.click(screen.getByText('已结束（2）'));
    expect(screen.getByText('整理资料')).toBeVisible();
    expect(screen.getByText('已取消')).toBeVisible();
  });
  it('does not invent progress when there are no tasks', () => {
    render(<ProjectProgress detail={{ ...detail, tasks: [] }} />);
    expect(screen.getByText('还没有任务记录')).toBeVisible();
    expect(screen.queryByText(/已完成 \d/)).toBeNull();
  });
  it('keeps the last known tasks visible and identifies stale progress on refresh failure', () => {
    render(<ProjectProgress stale detail={detail} />);
    expect(screen.getByText('制作文案')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('进度更新失败');
  });
});
