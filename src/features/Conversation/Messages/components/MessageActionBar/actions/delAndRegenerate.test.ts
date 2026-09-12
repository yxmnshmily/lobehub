/** @vitest-environment happy-dom */
import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { delAndRegenerateAction } from './delAndRegenerate';

const state = vi.hoisted(() => ({
  context: { groupId: 'group-1' },
  delAndRegenerateMessage: vi.fn(),
  groupMap: {} as Record<string, { clientId: string }>,
}));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('../../../../store', () => ({
  messageStateSelectors: { isMessageRegenerating: () => () => false },
  useConversationStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('delete and regenerate action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.groupMap = {};
  });

  it.each([false, true])(
    'describes retained group history without changing ordinary chat (%s)',
    (hosted) => {
      if (hosted) state.groupMap['group-1'] = { clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID };
      const { result } = renderHook(() =>
        delAndRegenerateAction.useBuild({
          id: 'reply',
          role: 'assistant',
          data: { id: 'reply' } as any,
        }),
      );
      expect(result.current?.label).toBe(
        hosted ? 'messageAction.regenerateKeepHistory' : 'messageAction.delAndRegenerate',
      );
      result.current?.handleClick?.();
      expect(state.delAndRegenerateMessage).toHaveBeenCalledWith('reply');
    },
  );
});
