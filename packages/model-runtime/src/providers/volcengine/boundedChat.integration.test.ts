// @vitest-environment node
import '../deepseek/__tests__/testUtils';

import { describe, expect, it, vi } from 'vitest';

import { LobeVolcengineAI } from './index';

describe('bounded Ark generation', () => {
  const limits = { contextWindowTokens: 262144, maxOutput: 32768 };

  it('caps a Responses-only Seed turn on the actual request and does not retry failures', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    const runtime = new LobeVolcengineAI({ apiKey: 'test-only', fetch });
    const payload = {
      messages: [{ content: '审核这条旅游文案', role: 'user' as const }],
      model: 'doubao-seed-2.1-turbo',
      stream: false,
      thinking: { type: 'enabled' as const },
      tools: [
        { type: 'function' as const, function: { name: 'review', parameters: { type: 'object' } } },
      ],
    };
    const prepared = await runtime.prepareChatBounded(payload, 8192, limits);
    expect(prepared.inputTokenLimit).toBe(262144);
    expect(prepared.maxOutputTokens).toBe(8192);
    expect(fetch).not.toHaveBeenCalled();
    await expect(prepared.chat(payload, { user: 'group-member-user' })).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    const body =
      typeof url === 'object' && 'text' in url
        ? JSON.parse(await url.text())
        : JSON.parse(options.body);
    expect(typeof url === 'string' ? url : url.url).toContain('/responses');
    expect(body.max_output_tokens).toBe(8192);
    expect(body.model).toBe('doubao-seed-2-1-turbo-260628');
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.n).toBeUndefined();
    expect(body.safety_identifier).toBeUndefined();
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.tools).toHaveLength(1);
    await expect(prepared.chat(payload)).rejects.toThrow('already executed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{ model: 'unknown-model' }, { model: 'doubao-seed-2.1-turbo', enabledSearch: true }])(
    'retains conservative reservation for unverified routes: %j',
    async (extra) => {
      const runtime = new LobeVolcengineAI({ apiKey: 'test-only' });
      const prepared = await runtime.prepareChatBounded({ messages: [], ...extra }, 8192, limits);
      expect(prepared.maxOutputTokens).toBe(262144);
    },
  );

  it('keeps the native Seed output cap when a custom filter selects Chat', async () => {
    const runtime = new LobeVolcengineAI({
      apiKey: 'test-only',
      chatCompletion: { useResponseModels: ['other'] },
    });
    const prepared = await runtime.prepareChatBounded(
      { messages: [], model: 'doubao-seed-2.1-turbo', apiMode: 'responses' },
      8192,
      limits,
    );
    expect(prepared.maxOutputTokens).toBe(8192);
  });

  it('uses the verified native cap for an explicit Seed Responses route', async () => {
    const runtime = new LobeVolcengineAI({ apiKey: 'test-only' });
    const prepared = await runtime.prepareChatBounded(
      { messages: [], model: 'doubao-seed-2.1-turbo', apiMode: 'responses' },
      8192,
      limits,
    );
    expect(prepared.maxOutputTokens).toBe(8192);
  });

  it('does not assume an opaque model mapping supports the native cap', async () => {
    const runtime = new LobeVolcengineAI({
      apiKey: 'test-only',
      modelIdMapping: { 'doubao-seed-2.1-turbo': 'ep-unknown' },
    });
    const prepared = await runtime.prepareChatBounded(
      { messages: [], model: 'doubao-seed-2.1-turbo' },
      8192,
      limits,
    );
    expect(prepared.maxOutputTokens).toBe(262144);
  });

  it.each([
    { model: 'doubao-seed-2.1-pro', wire: 'doubao-seed-2-1-pro-260628' },
    {
      model: 'doubao-seed-2.1-pro',
      apiMode: 'responses' as const,
      wire: 'doubao-seed-2-1-pro-260628',
    },
    { model: 'doubao-seed-2.1-turbo', enabledSearch: true, wire: 'doubao-seed-2-1-turbo-260628' },
    { model: 'doubao-seed-2.1-turbo', override: 'ep-custom', wire: 'ep-custom' },
  ])('maps saved aliases on the actual request: %j', async ({ wire, override, ...extra }) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    const runtime = new LobeVolcengineAI({
      apiKey: 'test-only',
      fetch,
      ...(override ? { modelIdMapping: { [extra.model]: override } } : {}),
    });
    await expect(runtime.chat({ messages: [], stream: false, ...extra })).rejects.toBeDefined();
    const [url, options] = fetch.mock.calls[0];
    const body =
      typeof url === 'object' && 'text' in url
        ? JSON.parse(await url.text())
        : JSON.parse(options.body);
    expect(body.model).toBe(wire);
  });

  it('keeps the quoted Chat route even when a stateful route filter changes', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    const runtime = new LobeVolcengineAI({
      apiKey: 'test-only',
      fetch,
      chatCompletion: { useResponseModels: [/doubao/g] },
    });
    const payload = { messages: [], model: 'doubao-seed-2.1-turbo', stream: false };
    await runtime.prepareChatBounded(payload, 8192, limits);
    const prepared = await runtime.prepareChatBounded(payload, 8192, limits);
    expect(prepared.maxOutputTokens).toBe(8192);
    await expect(prepared.chat(payload)).rejects.toBeDefined();
    const [url, options] = fetch.mock.calls[0];
    expect(typeof url === 'string' ? url : url.url).toContain('/chat/completions');
    const body =
      typeof url === 'object' && 'text' in url
        ? JSON.parse(await url.text())
        : JSON.parse(options.body);
    expect(body.max_completion_tokens).toBe(8192);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
