// @vitest-environment node
import '../providers/deepseek/__tests__/testUtils';

import { describe, expect, it, vi } from 'vitest';

import { LobeVolcengineAI } from '../providers/volcengine';

describe('bounded group member Responses request', () => {
  it.each([true, false])(
    'keeps the group member request compatible with Responses (stream=%s)',
    async (stream) => {
      const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
      const runtime = new LobeVolcengineAI({ apiKey: 'test-only', fetch });
      const payload = {
        frequency_penalty: 0,
        messages: [
          { content: '审核文案：带娃游桂林，看山水、享亲子慢时光。', role: 'user' as const },
        ],
        model: 'doubao-seed-2.1-turbo',
        presence_penalty: 0,
        preserveThinking: true,
        stream,
        temperature: 1,
        top_p: 1,
        tools: [
          {
            type: 'function' as const,
            function: { name: 'review', parameters: { type: 'object' } },
          },
        ],
      };
      const prepared = await runtime.prepareChatBounded(payload, 8192, {
        contextWindowTokens: 262144,
        maxOutput: 32768,
      });
      await expect(prepared.chat(payload, { user: 'group-member-fixture' })).rejects.toBeDefined();

      expect(fetch).toHaveBeenCalledTimes(1);
      const [request, options] = fetch.mock.calls[0];
      const body =
        typeof request === 'object' && 'text' in request
          ? JSON.parse(await request.text())
          : JSON.parse(options.body);
      expect(typeof request === 'string' ? request : request.url).toContain('/responses');
      expect(body.model).toBe('doubao-seed-2-1-turbo-260628');
      expect(body.max_output_tokens).toBe(8192);
      // Responses produces one response; unlike Chat Completions it has no `n` parameter.
      expect(body).not.toHaveProperty('n');
      expect(body).not.toHaveProperty('safety_identifier');
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('frequency_penalty');
      expect(body).not.toHaveProperty('presence_penalty');
      expect(body).not.toHaveProperty('preserveThinking');
      expect(body.tools).toEqual([
        { name: 'review', parameters: { type: 'object' }, type: 'function' },
      ]);
    },
  );
});
