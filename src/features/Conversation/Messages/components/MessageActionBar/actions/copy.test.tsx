import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupChatPresentation } from '@/features/SuperGroup/GroupChatPresentation';

import { copyAction } from './copy';

const copy = vi.hoisted(() => vi.fn());
vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyToClipboard: copy,
}));
beforeEach(() => copy.mockClear());

describe('copy a group agent reply', () => {
  const content = '<group_reply ref="msg%5FA" />\n我来检查你的文案';
  it.each(['assistant', 'group'] as const)('omits internal quote metadata for %s', async (role) => {
    const { result } = renderHook(
      () => copyAction.useBuild({ role, id: 'msg_B', data: { id: 'msg_B', content } as any }),
      {
        wrapper: ({ children }) => (
          <GroupChatPresentation.Provider value>{children}</GroupChatPresentation.Provider>
        ),
      },
    );
    await result.current!.handleClick?.();
    expect(copy).toHaveBeenCalledWith('我来检查你的文案');
  });
  it('does not change private chat copies', async () => {
    const { result } = renderHook(() =>
      copyAction.useBuild({
        role: 'assistant',
        id: 'msg_B',
        data: { id: 'msg_B', content } as any,
      }),
    );
    await result.current!.handleClick?.();
    expect(copy).toHaveBeenCalledWith(content);
  });
});
