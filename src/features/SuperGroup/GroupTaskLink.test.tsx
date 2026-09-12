import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GroupLogs } from './GroupTaskLink';

const calls = vi.hoisted(() => ({ query: vi.fn(), push: vi.fn(), exportQuery: vi.fn() }));
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push: calls.push }) }));
vi.mock('@/features/CustomerCenter/useMonthlyExchangeRate', () => ({
  useMonthlyExchangeRate: () => ({
    money: (n: number | null) => (n == null ? '未记录' : `¥${n * 7}`),
  }),
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: { groupConversation: { listTasks: { query: calls.exportQuery } } },
  lambdaQuery: {
    groupConversation: {
      listTasks: {
        useQuery: (input: unknown) => {
          calls.query(input);
          return {
            data: {
              items: [
                {
                  id: 'safe-id',
                  status: 'error',
                  createdAt: new Date('2026-09-01'),
                  completedAt: null,
                  startedAt: null,
                  totalCost: null,
                  currency: 'USD',
                  totalTokens: null,
                  totalInputTokens: null,
                  totalOutputTokens: null,
                  processingTimeMs: null,
                  stepCount: 2,
                  llmCalls: 1,
                  toolCalls: 0,
                  model: 'test-model',
                  provider: 'provider',
                  agentName: '旅游助手',
                  topicId: 'topic-1',
                  topicTitle: '桂林行程',
                  errorCode: 'rate_limit',
                  completionReason: 'error',
                },
              ],
              nextOffset: 50,
            },
            refetch: vi.fn(),
          };
        },
      },
    },
  },
}));

describe('group logs', () => {
  it('exports all filtered pages, not just the visible page', async () => {
    calls.exportQuery
      .mockResolvedValueOnce({ items: [{ id: 'first' }], nextOffset: 50 })
      .mockResolvedValueOnce({ items: [{ id: 'second' }], nextOffset: null });
    const createUrl = vi.fn().mockReturnValue('blob:logs');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<GroupLogs groupId="group-1" />);
    fireEvent.click(screen.getByRole('button', { name: '异常日志' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(calls.exportQuery).toHaveBeenNthCalledWith(1, {
      groupId: 'group-1',
      category: 'error',
      offset: 0,
    });
    expect(calls.exportQuery).toHaveBeenNthCalledWith(2, {
      groupId: 'group-1',
      category: 'error',
      offset: 50,
    });
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(createUrl.mock.calls[0][0]);
    });
    expect(JSON.parse(content)).toMatchObject({
      category: 'error',
      items: [{ id: 'first' }, { id: 'second' }],
    });
    click.mockRestore();
  });
  it('shows export failure without downloading partial data', async () => {
    calls.exportQuery
      .mockResolvedValueOnce({ items: [{ id: 'partial' }], nextOffset: 50 })
      .mockRejectedValueOnce(new Error('private error'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<GroupLogs groupId="group-1" />);
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    expect(await screen.findByText('导出失败，请重试；未生成不完整文件。')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    expect(screen.queryByText('private error')).not.toBeInTheDocument();
    click.mockRestore();
  });
  it('shows useful execution fields, marks unmeasured usage and navigates to the topic', () => {
    const onNavigate = vi.fn();
    render(<GroupLogs groupId="group-1" onNavigate={onNavigate} />);
    expect(screen.getByText('旅游助手')).toBeInTheDocument();
    expect(screen.getByText(/test-model/)).toBeInTheDocument();
    expect(screen.getAllByText(/未记录/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '查看话题' }));
    expect(calls.push).toHaveBeenCalledWith('/group/group-1#topic%3Atopic-1', { replace: true });
    expect(onNavigate).toHaveBeenCalledOnce();
  });
  it('resets pagination when changing the server-side log filter', () => {
    render(<GroupLogs groupId="group-1" />);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(calls.query).toHaveBeenLastCalledWith({
      groupId: 'group-1',
      offset: 50,
      category: 'all',
    });
    fireEvent.click(screen.getByRole('button', { name: '异常日志' }));
    expect(calls.query).toHaveBeenLastCalledWith({
      groupId: 'group-1',
      offset: 0,
      category: 'error',
    });
  });
});
