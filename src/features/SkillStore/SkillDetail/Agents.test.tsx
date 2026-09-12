import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Agents from './Agents';

const state = vi.hoisted(() => ({ identifier: 'docs', userId: 'owner' }));
const queryAgents = vi.hoisted(() => vi.fn());
const marketQuery = vi.hoisted(() => vi.fn());
vi.mock('@/services/agent', () => ({ agentService: { queryAgents } }));
vi.mock('@/services/discover', () => ({ discoverService: { getAgentsByPlugin: marketQuery } }));
vi.mock('@/store/user', () => ({ useUserStore: () => state.userId }));
vi.mock('@/store/user/selectors', () => ({ userProfileSelectors: { userId: vi.fn() } }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => null,
}));
vi.mock('./DetailContext', () => ({ useDetailContext: () => ({ identifier: state.identifier }) }));
vi.mock('./AgentItem', () => ({
  default: ({ agentId, title }: { agentId: string; title: string }) => (
    <a href={`/agent/${agentId}`}>{title}</a>
  ),
}));
vi.mock('react-virtuoso', () => ({
  VirtuosoGrid: ({ data, itemContent, endReached }: any) => (
    <div>
      {data.map((item: any, index: number) => (
        <div key={item.id}>{itemContent(index, item)}</div>
      ))}
      <button onClick={endReached}>更多</button>
    </div>
  ),
}));
const row = (id: string) => ({
  id,
  title: id,
  name: null,
  avatar: null,
  backgroundColor: null,
  description: null,
});
const view = () => (
  <SWRConfig value={{ provider: () => new Map() }}>
    <Agents />
  </SWRConfig>
);

beforeEach(() => {
  state.identifier = 'docs';
  state.userId = 'owner';
  queryAgents.mockReset();
  marketQuery.mockReset();
});

describe('local skill usage list', () => {
  it('loads local members without waiting for the external market', async () => {
    queryAgents.mockResolvedValue([row('member-1')]);
    render(view());
    expect(await screen.findByRole('link', { name: 'member-1' })).toHaveAttribute(
      'href',
      '/agent/member-1',
    );
    expect(queryAgents).toHaveBeenCalledWith({ pluginId: 'docs', limit: 13, offset: 0 });
    expect(marketQuery).not.toHaveBeenCalled();
  });
  it('paginates with a lookahead row without repeating members', async () => {
    queryAgents.mockImplementation(({ offset }) =>
      Promise.resolve(
        Array.from({ length: offset ? 1 : 13 }, (_, i) => row(`member-${offset + i}`)),
      ),
    );
    render(view());
    await screen.findByRole('link', { name: 'member-0' });
    expect(screen.queryByRole('link', { name: 'member-12' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    await screen.findByRole('link', { name: 'member-12' });
    expect(screen.getAllByRole('link')).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(queryAgents).toHaveBeenCalledTimes(2);
  });
  it('discards the previous skill list when switching skills', async () => {
    queryAgents.mockImplementation(({ pluginId }) => Promise.resolve([row(pluginId)]));
    const { rerender } = render(view());
    await screen.findByRole('link', { name: 'docs' });
    state.identifier = 'search';
    rerender(view());
    await screen.findByRole('link', { name: 'search' });
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'docs' })).not.toBeInTheDocument(),
    );
  });
});
