import { describe, expect, it, vi } from 'vitest';

import { prepareBoundedChat } from './boundedChat';

describe('selected model bounded chat contract', () => {
  const limits = { contextWindowTokens: 1048576, maxOutput: 393216 };
  const payload = {
    messages: [{ content: '写十条文案', role: 'user' as const }],
    model: 'deepseek-v4-flash',
  };

  it('locks the payload and output limit, with one provider execution only', async () => {
    const chat = vi.fn().mockResolvedValue(new Response('ok'));
    const input = structuredClone(payload);
    const prepared = prepareBoundedChat({ chat, limits, maxOutputTokens: 8192, payload: input });
    input.messages[0].content = 'changed';
    await prepared.chat({ ...payload, max_tokens: 999999 });
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192, messages: payload.messages }),
      undefined,
    );
    expect(prepared.inputTokenLimit).toBe(1_048_576);
    expect(prepared.maxOutputTokens).toBe(1048576);
    await expect(prepared.chat(payload)).rejects.toThrow('already executed');
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, NaN])('rejects missing or invalid model capacity %s', (contextWindowTokens) => {
    expect(() =>
      prepareBoundedChat({
        chat: vi.fn(),
        limits: { ...limits, contextWindowTokens },
        maxOutputTokens: 8192,
        payload,
      }),
    ).toThrow();
  });

  it('rejects invalid output limits without restricting model names', () => {
    for (const maxOutputTokens of [0, NaN, 393217]) {
      expect(() =>
        prepareBoundedChat({ chat: vi.fn(), limits, maxOutputTokens, payload }),
      ).toThrow();
    }
    expect(() =>
      prepareBoundedChat({
        chat: vi.fn(),
        limits,
        maxOutputTokens: 8192,
        payload: { ...payload, model: 'admin-configured-model' },
      }),
    ).not.toThrow();
  });
});
