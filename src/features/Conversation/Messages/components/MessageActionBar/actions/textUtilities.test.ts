/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { translateAction } from './translate';
import { ttsAction } from './tts';

const mocks = vi.hoisted(() => ({ startMessageTTS: vi.fn(), translateMessage: vi.fn() }));
vi.mock('../../../../store', () => ({
  useConversationStore: (selector: (s: typeof mocks) => unknown) => selector(mocks),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const context = (role: MessageActionContext['role'], withText = true): MessageActionContext => ({
  contentBlock: withText ? { content: 'Reply', id: 'text-1' } : undefined,
  data: { content: '', id: 'group-1', role: 'assistantGroup' } as MessageActionContext['data'],
  id: 'group-1',
  role,
});

describe('message text utilities', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['group', 'assistant'] as const)('targets the persisted text for %s', (role) => {
    const ctx = context(role);
    const tts = renderHook(() => ttsAction.useBuild(ctx)).result.current!;
    const translate = renderHook(() => translateAction.useBuild(ctx)).result.current!;
    tts.handleClick!();
    const language = translate.children![0];
    language.handleClick!();
    const id = role === 'group' ? 'text-1' : 'group-1';
    expect(mocks.startMessageTTS).toHaveBeenCalledWith(id);
    expect(mocks.translateMessage).toHaveBeenCalledWith(id, language.key);
  });

  it('omits text utilities for a tool-only group', () => {
    const ctx = context('group', false);
    expect(renderHook(() => ttsAction.useBuild(ctx)).result.current).toBeNull();
    expect(renderHook(() => translateAction.useBuild(ctx)).result.current).toBeNull();
  });
});
