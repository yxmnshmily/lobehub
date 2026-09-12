import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeModelContext, getRuntimeModelLabel } from './RuntimeModelContext';
import { useEffectiveModel } from './hooks/useEffectiveModel';

vi.mock('@/store/agent', () => ({ useAgentStore: () => ['personal-model', 'personal-provider'] }));
vi.mock('@/store/chat', () => ({
  useChatStore: () => ({ model: 'previous-topic', provider: 'other' }),
}));

describe('member runtime model', () => {
  it('does not describe a completed request with no model as loading', () => {
    expect(getRuntimeModelLabel({ status: 'ready', model: '', provider: '' })).toBe('群模型未配置');
    expect(getRuntimeModelLabel({ status: 'loading', model: '', provider: '' })).toBe(
      '群模型加载中…',
    );
    expect(getRuntimeModelLabel({ status: 'error', model: '', provider: '' })).toBe(
      '群模型加载失败，点击重试',
    );
  });
  it('uses the group model instead of a previous personal topic', () => {
    const { result } = renderHook(() => useEffectiveModel(''), {
      wrapper: ({ children }) => (
        <RuntimeModelContext
          value={{ model: 'group-model', provider: 'group-provider', status: 'ready' }}
        >
          {children}
        </RuntimeModelContext>
      ),
    });
    expect(result.current).toEqual({ model: 'group-model', provider: 'group-provider' });
  });
});
