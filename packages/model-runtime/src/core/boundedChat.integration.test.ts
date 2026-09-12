// @vitest-environment node
import '../providers/deepseek/__tests__/testUtils';

import { describe, expect, it, vi } from 'vitest';

import { LobeMoonshotAI } from '../providers/moonshot';
import { LobeOpenAI } from '../providers/openai';
import { LobeQwenAI } from '../providers/qwen';
import { LobeVolcengineAI } from '../providers/volcengine';

describe('selected model bounded execution', () => {
  it('uses the native Kimi total-output cap instead of reserving one million output tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    const runtime = new LobeMoonshotAI({ apiKey: 'test-only', fetch });
    const payload = { messages: [], model: 'kimi-k3' };
    const prepared = await runtime.prepareChatBounded(payload, 8192, {
      contextWindowTokens: 1_048_576,
      maxOutput: 1_048_576,
    });
    expect(prepared.maxOutputTokens).toBe(8192);
    await expect(prepared.chat(payload)).rejects.toBeDefined();
    const [url, options] = fetch.mock.calls[0];
    const request =
      typeof url === 'object' && 'text' in url
        ? JSON.parse(await url.text())
        : JSON.parse(options.body);
    expect(request.max_completion_tokens).toBe(8192);
  });
  it('reserves the Qwen total completion cap, not its million-token context window', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    const runtime = new LobeQwenAI({ apiKey: 'test-only', fetch });
    const payload = {
      messages: [{ content: '写一句话', role: 'user' as const }],
      model: 'qwen3.8-max',
    };
    const prepared = await runtime.prepareChatBounded(payload, 8192, {
      contextWindowTokens: 1_000_000,
      maxOutput: 131_072,
    });
    expect(prepared.maxOutputTokens).toBe(8202);
    await expect(prepared.chat(payload)).rejects.toBeDefined();
    const [url, options] = fetch.mock.calls[0];
    const request =
      typeof url === 'object' && 'text' in url
        ? JSON.parse(await url.text())
        : JSON.parse(options.body);
    expect(request.max_completion_tokens).toBe(8192);
    expect(request.max_tokens).toBeUndefined();
  });
  it('returns Qwen completion text and billing usage through the native stream', async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { content: '完成' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    ];
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const runtime = new LobeQwenAI({ apiKey: 'test-only', fetch });
    const payload = {
      messages: [{ content: 'test', role: 'user' as const }],
      model: 'ZHIPU/GLM-5.2',
    };
    const prepared = await runtime.prepareChatBounded(payload, 8192, {
      contextWindowTokens: 1048576,
      maxOutput: 131072,
    });
    const onCompletion = vi.fn();
    await (await prepared.chat(payload, { callback: { onCompletion } })).text();
    expect(onCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '完成',
        usage: expect.objectContaining({ totalInputTokens: 10, totalOutputTokens: 2 }),
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { Runtime: LobeOpenAI, model: 'gpt-5.6-luna' },
    { Runtime: LobeQwenAI, model: 'qwen3.8-max' },
    { Runtime: LobeQwenAI, model: 'kimi/kimi-k3' },
    { Runtime: LobeVolcengineAI, model: 'doubao-seed-2.1-turbo' },
  ])(
    'prepares $model using its selected runtime and configured channel',
    async ({ Runtime, model }) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'test failure' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const runtime = new Runtime({
        apiKey: 'test-only',
        baseURL: 'https://configured-channel.example/v1',
        fetch,
      });
      const payload = {
        messages: [{ content: 'test', role: 'user' as const }],
        model,
        stream: false,
      };
      const prepared = await runtime.prepareChatBounded(payload, 8192, {
        contextWindowTokens: 262144,
        maxOutput: 32768,
      });
      expect(fetch).not.toHaveBeenCalled();
      await expect(prepared.chat(payload)).rejects.toBeDefined();
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = fetch.mock.calls[0];
      const request =
        typeof url === 'object' && 'text' in url
          ? JSON.parse(await url.text())
          : JSON.parse(options.body);
      expect(request.model).toBe(model);
      expect(new URL(typeof url === 'string' ? url : url.url).hostname).toBe(
        'configured-channel.example',
      );
      expect(request.max_output_tokens ?? request.max_completion_tokens ?? request.max_tokens).toBe(
        8192,
      );
    },
  );
});
