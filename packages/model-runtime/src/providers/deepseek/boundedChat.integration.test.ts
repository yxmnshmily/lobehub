// @vitest-environment node
import './__tests__/testUtils';

import { describe, expect, it, vi } from 'vitest';

import { LobeDeepSeekAI } from './index';

describe('bounded DeepSeek through the real router and SDK', () => {
  const limits = { contextWindowTokens: 1048576, maxOutput: 393216 };
  it.each(['openai', 'anthropic'])(
    'reserves the full documented output capacity through %s',
    async (sdkType) => {
      const runtime = new LobeDeepSeekAI({ apiKey: 'test-only', sdkType });
      const payload = { messages: [], model: 'deepseek-v4-pro' };
      const prepared = await runtime.prepareChatBounded(payload, 8192, limits);
      expect(prepared.inputTokenLimit).toBe(1048576);
      expect(prepared.maxOutputTokens).toBe(393216);
    },
  );
  it.each(['openai', 'anthropic'])(
    'keeps unknown mapped output limits conservative through %s',
    async (sdkType) => {
      const runtime = new LobeDeepSeekAI({
        apiKey: 'test-only',
        sdkType,
        modelIdMapping: { 'deepseek-v4-pro': 'unknown-model' },
      });
      const prepared = await runtime.prepareChatBounded(
        { messages: [], model: 'deepseek-v4-pro' },
        8192,
        limits,
      );
      expect(prepared.maxOutputTokens).toBe(1048576);
    },
  );
  it.each(['openai', 'anthropic'])(
    'retains completion text and usage through %s',
    async (sdkType) => {
      const body =
        sdkType === 'openai'
          ? {
              id: 'test-completion',
              object: 'chat.completion',
              model: 'deepseek-v4-flash',
              choices: [
                {
                  index: 0,
                  finish_reason: 'stop',
                  message: { role: 'assistant', content: '完成', reasoning_content: '' },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }
          : {
              id: 'test-completion',
              type: 'message',
              role: 'assistant',
              model: 'deepseek-v4-flash',
              content: [{ type: 'text', text: '完成' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 10, output_tokens: 2 },
            };
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
        );
      const runtime = new LobeDeepSeekAI({ apiKey: 'test-only', fetch, sdkType });
      const payload = {
        messages: [{ content: '测试', role: 'user' as const }],
        model: 'deepseek-v4-flash',
        stream: false,
      };
      const prepared = await runtime.prepareChatBounded(payload, 8192, limits);
      const onCompletion = vi.fn();
      const response = await prepared.chat(payload, { callback: { onCompletion } });
      await response.text();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(onCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          text: '完成',
          usage: expect.objectContaining({ totalInputTokens: 10, totalOutputTokens: 2 }),
        }),
      );
    },
  );

  it.each(['openai', 'anthropic'])(
    'preserves the cap on the actual %s request without retrying',
    async (sdkType) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: 'test unavailable', type: 'server_error' } }),
            { status: 500, headers: { 'content-type': 'application/json' } },
          ),
        );
      const runtime = new LobeDeepSeekAI({ apiKey: 'test-only', fetch, sdkType });
      const payload = {
        messages: [{ content: '写十条文案', role: 'user' as const }],
        model: 'deepseek-v4-flash',
        stream: false,
        tools: [
          {
            function: { name: 'finish', parameters: { type: 'object' } },
            type: 'function' as const,
          },
        ],
      };
      const prepared = await runtime.prepareChatBounded(payload, 8192, limits);
      expect(fetch).not.toHaveBeenCalled();
      await expect(prepared.chat(payload)).rejects.toBeDefined();
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = fetch.mock.calls[0];
      const request =
        typeof url === 'object' && 'text' in url
          ? JSON.parse(await url.text())
          : JSON.parse(options.body);
      expect(request.max_tokens).toBe(8192);
      expect(request.model).toBe('deepseek-v4-flash');
      expect(request.tools).toHaveLength(1);
    },
  );

  it('preserves the configured model-id mapping on the actual request', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'test failure' } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const runtime = new LobeDeepSeekAI({
      apiKey: 'test-only',
      fetch,
      sdkType: 'anthropic',
      modelIdMapping: { 'deepseek-v4-flash': 'other-model' },
    });
    const payload = { messages: [], model: 'deepseek-v4-flash', stream: false };
    const prepared = await runtime.prepareChatBounded(payload, 8192, limits);
    expect(fetch).not.toHaveBeenCalled();
    await expect(prepared.chat(payload)).rejects.toBeDefined();
    const [url, options] = fetch.mock.calls[0];
    const request =
      typeof url === 'object' && 'text' in url
        ? JSON.parse(await url.text())
        : JSON.parse(options.body);
    expect(request.model).toBe('other-model');
  });
});
