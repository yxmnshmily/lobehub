import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const { fetchList, retry } = vi.hoisted(() => ({ fetchList: vi.fn(), retry: vi.fn() }));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Popover: ({ content }: { content: ReactNode }) => <div>{content}</div>,
}));
vi.mock('@/features/HomeSidebar/Body/Agent/ModalProvider', () => ({
  AgentModalProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/features/HomeSidebar/Body/Agent/List', () => ({
  default: ({ error, onRetry }: { error?: Error; onRetry?: () => void }) => (
    <div>
      {error?.message}
      <button onClick={onRetry}>重试</button>
    </div>
  ),
}));
vi.mock('@/features/NavPanel/components/SkeletonList', () => ({ default: () => null }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));
vi.mock('@/hooks/useFetchAgentList', () => ({ useFetchAgentList: fetchList }));

import SwitchPanel from './SwitchPanel';

describe('group switcher standalone loading', () => {
  it('subscribes without the Home sidebar and forwards fetch failures to retry', () => {
    fetchList.mockReturnValue({ error: new Error('列表请求失败'), mutate: retry });
    render(<SwitchPanel>切换</SwitchPanel>);
    expect(fetchList).toHaveBeenCalled();
    expect(screen.getByText('列表请求失败')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
