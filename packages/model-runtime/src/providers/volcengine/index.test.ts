// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeVolcengineAI } from './index';

testProvider({
  Runtime: LobeVolcengineAI,
  provider: ModelProvider.Volcengine,
  defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  chatDebugEnv: 'DEBUG_VOLCENGINE_CHAT_COMPLETION',
  chatModel: 'doubao-pro-32k',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeVolcengineAI - custom features', () => {
  let instance: InstanceType<typeof LobeVolcengineAI>;

  beforeEach(() => {
    instance = new LobeVolcengineAI({ apiKey: 'test_api_key' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  describe('handlePayload', () => {
    it.each(['doubao-seed-2.1-turbo', 'doubao-seed-2.1-pro'])(
      'routes the saved Seed 2.1 alias through the Responses API: %s',
      async (model) => {
        const responses = vi
          .spyOn(instance['client'].responses, 'create')
          .mockResolvedValue(new ReadableStream() as any);

        await instance.chat({
          messages: [{ content: '审核这条旅游文案', role: 'user' }],
          model,
        });

        expect(responses).toHaveBeenCalledTimes(1);
        expect(instance['client'].chat.completions.create).not.toHaveBeenCalled();
        expect((responses as any).mock.calls[0][0].model).toMatch(
          /^doubao-seed-2-1-(?:turbo|pro)-260628$/,
        );
      },
    );

    it('does not send OpenAI-only safety_identifier to Ark Responses', async () => {
      const responses = vi
        .spyOn(instance['client'].responses, 'create')
        .mockResolvedValue(new ReadableStream() as any);

      await instance.chat(
        {
          messages: [{ content: '审核这条旅游文案', role: 'user' }],
          model: 'doubao-seed-2.1-turbo',
        },
        { user: 'group-member-user' },
      );

      expect((responses as any).mock.calls[0][0]).not.toHaveProperty('safety_identifier');
    });

    it('does not force a custom compatible endpoint onto Ark Responses semantics', async () => {
      const custom = new LobeVolcengineAI({
        apiKey: 'test_api_key',
        baseURL: 'https://gateway.example.test/v1',
      });
      const chat = vi
        .spyOn(custom['client'].chat.completions, 'create')
        .mockResolvedValue(new ReadableStream() as any);
      const responses = vi
        .spyOn(custom['client'].responses, 'create')
        .mockResolvedValue(new ReadableStream() as any);

      await custom.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'doubao-seed-2.1-turbo',
      });

      expect(chat).toHaveBeenCalledTimes(1);
      expect(responses).not.toHaveBeenCalled();
      expect((chat as any).mock.calls[0][0].model).toBe('doubao-seed-2.1-turbo');
    });

    it('should add thinking for thinking-vision-pro model', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'thinking-vision-pro',
        thinking: {
          type: 'enabled',
          budget_tokens: 1000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
    });

    it('should add thinking for deepseek-v3-1 model', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v3-1',
        thinking: {
          type: 'enabled',
          budget_tokens: 2000,
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
    });

    it('should map deepseek-v4 thinking disabled to minimal reasoning_effort', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        thinking: {
          type: 'disabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'disabled' });
      expect(calledPayload.reasoning_effort).toBe('minimal');
    });

    it('should map deepseek-v4 thinking enabled without reasoning_effort to high reasoning_effort', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning_effort).toBe('high');
    });

    it('should preserve reasoning_effort for deepseek-v4 when explicitly set', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        reasoning_effort: 'max',
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning_effort).toBe('max');
    });

    it('should fallback reasoning_effort max to high for deepseek-v4 under responses path (enabledSearch: true)', async () => {
      // Mock the Responses API client call
      vi.spyOn(instance['client'].responses, 'create').mockResolvedValue(
        new ReadableStream() as any,
      );

      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        reasoning_effort: 'max',
        enabledSearch: true,
        thinking: {
          type: 'enabled',
        },
      });

      const calledPayload = (instance['client'].responses.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning.effort).toBe('high');
    });

    /**
     * `adaptive` is in the runtime's own `thinking.type` union — it is Anthropic's
     * "let the model decide" — and Ark answers it with
     * `invalid value adaptive`, failing the whole request.
     *
     * It is not a synthetic input: `/api/v1/anthropic` relays an Anthropic
     * client's body, and Claude Code sends `thinking: {type: 'adaptive'}` on
     * every request whatever model it has been pointed at. Both model families
     * are covered because they take different branches here — the reasoning-effort
     * family used to fall past its `disabled` / `enabled` cases, and everything
     * else skipped the branch entirely.
     */
    it.each(['doubao-seed-2-1-pro-260628', 'deepseek-v4-pro-260425'])(
      'drops a thinking type Ark does not accept, for %s',
      async (model) => {
        const responses = vi
          .spyOn(instance['client'].responses, 'create')
          .mockResolvedValue(new ReadableStream() as any);
        await instance.chat({
          messages: [{ content: 'Hello', role: 'user' }],
          model,
          thinking: { type: 'adaptive' },
        });

        const calledPayload = model.startsWith('doubao-seed-2-1')
          ? (responses as any).mock.calls[0][0]
          : (instance['client'].chat.completions.create as any).mock.calls[0][0];
        expect(calledPayload).not.toHaveProperty('thinking');
      },
    );

    it('still honours reasoning_effort when the thinking type was dropped', async () => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model: 'deepseek-v4-pro-260425',
        reasoning_effort: 'low',
        thinking: { type: 'adaptive' },
      });

      const calledPayload = (instance['client'].chat.completions.create as any).mock.calls[0][0];
      expect(calledPayload.thinking).toEqual({ type: 'enabled' });
      expect(calledPayload.reasoning_effort).toBe('low');
    });
  });
});
