import { fireEvent, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentProfilePopup from './AgentProfilePopup';

const navigate = vi.hoisted(() => vi.fn());
const getAgentConfig = vi.hoisted(() => vi.fn());
const resourceAccess = vi.hoisted(() => ({ canEditResource: true, isAccessResolved: true }));
vi.mock('@/services/agent', () => ({
  agentService: { getAgentConfigById: getAgentConfig },
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ allowed: true }) }));
vi.mock('@/features/ResourcePermission/useResourceAccess', () => ({
  useResourceAccess: () => resourceAccess,
}));
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Popover: ({ children, content, onOpenChange }: any) => (
    <>
      <button onClick={() => onOpenChange(true)}>展示预览</button>
      {children}
      {content}
    </>
  ),
}));

describe('member preview navigation', () => {
  beforeEach(() => {
    navigate.mockClear();
    getAgentConfig.mockReset();
    resourceAccess.canEditResource = true;
  });
  const preview = (readOnly = false) =>
    render(
      <AgentProfilePopup
        agent={{ name: 'Codex', description: '编程助手' }}
        agentId="agent-1"
        readOnly={readOnly}
      >
        <button>打开成员</button>
      </AgentProfilePopup>,
    );

  it('keeps the current page when clicking the preview title', () => {
    preview();
    fireEvent.click(screen.getByText('Codex'));
    fireEvent.click(screen.getAllByRole('img', { name: 'avatar' })[1]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens the profile only through its explicit action', () => {
    preview();
    fireEvent.click(screen.getByRole('button', { name: /查看档案|View profile|viewProfile/ }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/agent/agent-1/profile');
  });

  it('does not grant profile configuration navigation to a read-only viewer', () => {
    preview(true);
    expect(screen.queryByRole('button', { name: /查看档案|View profile|viewProfile/ })).toBeNull();
    fireEvent.click(screen.getByText('Codex'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('still requires resource edit permission without an explicit read-only override', () => {
    resourceAccess.canEditResource = false;
    preview();
    fireEvent.click(screen.getByRole('button', { name: '展示预览' }));
    expect(screen.queryByRole('button', { name: /查看档案|View profile|viewProfile/ })).toBeNull();
    expect(getAgentConfig).not.toHaveBeenCalled();
  });

  it('keeps the member page visible under the group layout suspense config while fetching a preview', () => {
    getAgentConfig.mockReturnValue(new Promise(() => {}));
    render(
      <SWRConfig value={{ provider: () => new Map(), suspense: true }}>
        <Suspense fallback={<div>整页加载</div>}>
          <div>成员列表</div>
          <AgentProfilePopup
            agent={{ name: 'Codex', description: '编程助手' }}
            agentId="agent-1"
            groupId="group-1"
          >
            <button>打开成员</button>
          </AgentProfilePopup>
        </Suspense>
      </SWRConfig>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展示预览' }));
    expect(getAgentConfig).toHaveBeenCalledWith('agent-1');
    expect(screen.queryByText('整页加载')).toBeNull();
    expect(screen.getByText('成员列表')).toBeVisible();
    expect(screen.getByText('Codex')).toBeVisible();
  });
});
