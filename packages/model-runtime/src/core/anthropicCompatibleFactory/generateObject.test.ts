// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  buildAnthropicGenerateObjectRequest,
  createAnthropicGenerateObject,
} from './generateObject';
import * as anthropicGenerateObject from './generateObject';

describe('Anthropic generateObject', () => {
  describe('bounded generation', () => {
    it('counts the final forced-tool input before exposing a single-use execution', async () => {
      const callOrder: string[] = [];
      const mockClient = {
        messages: {
          countTokens: vi.fn().mockImplementation(async () => {
            callOrder.push('count');
            return { input_tokens: 120 };
          }),
          create: vi.fn().mockImplementation(async () => {
            callOrder.push('create');
            return {
              content: [
                {
                  input: { content: 'Bounded copy' },
                  name: 'travel_copy',
                  type: 'tool_use',
                },
              ],
              usage: {
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                input_tokens: 120,
                output_tokens: 40,
              },
            };
          }),
        },
      };
      const payload = {
        messages: [
          { content: 'You write travel copy.', role: 'system' as const },
          { content: 'Write one paragraph.', role: 'user' as const },
        ],
        model: 'claude-sonnet-4-20250514',
        schema: {
          name: 'travel_copy',
          schema: {
            additionalProperties: false,
            properties: { content: { type: 'string' } },
            required: ['content'],
            type: 'object' as const,
          },
        },
      };
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-sonnet-4-20250514',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };
      const pricing = {
        units: [
          { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        ],
      };
      const prepare = (anthropicGenerateObject as any).prepareAnthropicGenerateObjectBounded;

      const prepared = await prepare(mockClient as any, payload, undefined, pricing, {
        maxOutputTokens: 256,
        route,
      });

      expect(callOrder).toEqual(['count']);
      expect(prepared.envelope).toEqual({
        inputTokens: 120,
        maxOutputTokens: 256,
        maximumCredits: 4200,
        route,
      });
      expect(Object.isFrozen(prepared.envelope)).toBe(true);
      expect(Object.isFrozen(prepared.envelope.route)).toBe(true);
      expect(mockClient.messages.countTokens).toHaveBeenCalledWith(
        {
          messages: [{ content: 'Write one paragraph.', role: 'user' }],
          model: 'claude-sonnet-4-20250514',
          system: [{ text: 'You write travel copy.', type: 'text' }],
          thinking: { type: 'disabled' },
          tool_choice: { name: 'travel_copy', type: 'tool' },
          tools: [
            {
              description: 'Generate structured output according to the provided schema',
              input_schema: {
                additionalProperties: false,
                properties: { content: { type: 'string' } },
                required: ['content'],
                type: 'object',
              },
              name: 'travel_copy',
            },
          ],
        },
        expect.objectContaining({}),
      );

      await expect(prepared.execute()).resolves.toEqual({
        output: { content: 'Bounded copy' },
        usage: expect.objectContaining({
          cost: 0.000_96,
          totalInputTokens: 120,
          totalOutputTokens: 40,
        }),
      });
      expect(callOrder).toEqual(['count', 'create']);
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 256,
          model: 'claude-sonnet-4-20250514',
          thinking: { type: 'disabled' },
        }),
        expect.objectContaining({}),
      );
      await expect(prepared.execute()).rejects.toThrow('already executed');
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1);
    });

    it('executes the exact counted request even when the caller mutates its inputs after prepare', async () => {
      let countedRequest: Record<string, unknown> | undefined;
      let createdRequest: Record<string, unknown> | undefined;
      const client = {
        messages: {
          countTokens: vi.fn().mockImplementation(async (request) => {
            countedRequest = structuredClone(request);
            return { input_tokens: 10 };
          }),
          create: vi.fn().mockImplementation(async (request) => {
            createdRequest = structuredClone(request);
            return {
              content: [{ input: { content: 'ok' }, name: 'result', type: 'tool_use' }],
              usage: {
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                input_tokens: 10,
                output_tokens: 5,
              },
            };
          }),
        },
      };
      const payload = {
        messages: [{ content: 'Generate', role: 'user' as const }],
        model: 'claude-versioned',
        schema: {
          name: 'result',
          schema: {
            additionalProperties: false,
            properties: { content: { type: 'string' } },
            type: 'object' as const,
          },
        },
      };
      const pricing = {
        units: [
          { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        ],
      };
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };

      const prepared = await anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
        client as any,
        payload,
        undefined,
        pricing as any,
        { maxOutputTokens: 64, route },
      );
      payload.schema.schema.properties.content.type = 'number';
      payload.schema.schema.properties.injected = { type: 'boolean' };

      await expect(prepared.execute()).resolves.toEqual(
        expect.objectContaining({ output: { content: 'ok' } }),
      );
      expect(createdRequest).toEqual({ ...countedRequest, max_tokens: 64 });
      expect(
        (createdRequest?.tools as Array<{ input_schema: { properties: unknown } }>)[0].input_schema
          .properties,
      ).toEqual({ content: { type: 'string' } });
    });

    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['negative', -1],
      ['unsafe', Number.MAX_SAFE_INTEGER],
    ])('rejects %s Credits pricing before generation', async (_label, rate) => {
      const create = vi.fn();
      const client = {
        messages: {
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 10 }),
          create,
        },
      };
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };

      await expect(
        anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          client as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
          } as any,
          undefined,
          {
            units: [
              { name: 'textInput', rate, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('pricing is invalid');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects thinking and caller-supplied tools before token counting', async () => {
      const countTokens = vi.fn();
      const client = { messages: { countTokens, create: vi.fn() } };
      const pricing = {
        units: [
          { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
          { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        ],
      };
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };
      const prepare = anthropicGenerateObject.prepareAnthropicGenerateObjectBounded;

      await expect(
        prepare(
          client as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
            thinking: { type: 'enabled' },
          } as any,
          undefined,
          pricing as any,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('thinking to be disabled');

      await expect(
        prepare(
          client as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
            tools: [{ function: { name: 'external', parameters: {} }, type: 'function' }],
          } as any,
          undefined,
          pricing as any,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('one schema and no tools');

      await expect(
        prepare(
          client as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
            tools: [{ name: 'web_search', type: 'web_search_20250305' }],
          } as any,
          undefined,
          pricing as any,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('one schema and no tools');

      expect(countTokens).not.toHaveBeenCalled();
    });

    it('fails closed before generation when pricing or authoritative count is missing', async () => {
      const payload = {
        messages: [{ content: 'Generate', role: 'user' as const }],
        model: 'claude-versioned',
        schema: { name: 'result', schema: { properties: {}, type: 'object' as const } },
      };
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };
      const create = vi.fn();
      const client = {
        messages: { countTokens: vi.fn().mockResolvedValue({}), create },
      };

      await expect(
        anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          client as any,
          payload,
          undefined,
          undefined,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('pricing is unavailable');
      await expect(
        anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          client as any,
          payload,
          undefined,
          {
            units: [
              { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('input token count is unavailable');

      expect(create).not.toHaveBeenCalled();
    });

    it.each([
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['negative', -1],
      ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ])('rejects an authoritative %s input token count before generation', async (_label, count) => {
      const create = vi.fn();
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };

      await expect(
        anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          {
            messages: {
              countTokens: vi.fn().mockResolvedValue({ input_tokens: count }),
              create,
            },
          } as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
          } as any,
          undefined,
          {
            units: [
              { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 64, route },
        ),
      ).rejects.toThrow('input token count is unavailable');
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a combined input and output token budget above the safe integer range', async () => {
      const create = vi.fn();
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };

      await expect(
        anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          {
            messages: {
              countTokens: vi.fn().mockResolvedValue({ input_tokens: Number.MAX_SAFE_INTEGER }),
              create,
            },
          } as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
          } as any,
          undefined,
          {
            units: [
              { name: 'textInput', rate: 0.000_000_001, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 0.000_000_001, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 1, route },
        ),
      ).rejects.toThrow('token budget is invalid');
      expect(create).not.toHaveBeenCalled();
    });

    it('fails closed after the sole provider call when usage is missing', async () => {
      const create = vi.fn().mockResolvedValue({
        content: [{ input: { content: 'ok' }, name: 'result', type: 'tool_use' }],
      });
      const client = {
        messages: {
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 10 }),
          create,
        },
      };
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };
      const prepared = await anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
        client as any,
        {
          messages: [{ content: 'Generate', role: 'user' }],
          model: 'claude-versioned',
          schema: { name: 'result', schema: { properties: {}, type: 'object' } },
        } as any,
        undefined,
        {
          units: [
            { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
          ],
        } as any,
        { maxOutputTokens: 64, route },
      );

      await expect(prepared.execute()).rejects.toThrow('usage is unavailable');
      await expect(prepared.execute()).rejects.toThrow('already executed');
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('allows only one provider create when execute is replayed concurrently and fails', async () => {
      const create = vi.fn().mockRejectedValue(new Error('provider failed'));
      const route = {
        apiType: 'anthropic',
        channelId: 'anthropic-primary',
        model: 'claude-versioned',
        providerId: 'anthropic',
        routerId: 'anthropic',
      };
      const prepared = await anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
        {
          messages: {
            countTokens: vi.fn().mockResolvedValue({ input_tokens: 10 }),
            create,
          },
        } as any,
        {
          messages: [{ content: 'Generate', role: 'user' }],
          model: 'claude-versioned',
          schema: { name: 'result', schema: { properties: {}, type: 'object' } },
        } as any,
        undefined,
        {
          units: [
            { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
            { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
          ],
        } as any,
        { maxOutputTokens: 64, route },
      );

      const results = await Promise.allSettled([prepared.execute(), prepared.execute()]);

      expect(results).toEqual([
        expect.objectContaining({
          reason: expect.objectContaining({ message: 'provider failed' }),
        }),
        expect.objectContaining({
          reason: expect.objectContaining({ message: expect.stringContaining('already executed') }),
        }),
      ]);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['input', -1, 5],
      ['output', 10, -1],
      ['NaN input', Number.NaN, 5],
      ['infinite output', 10, Number.POSITIVE_INFINITY],
      ['unsafe input', Number.MAX_SAFE_INTEGER + 1, 5],
    ])(
      'rejects invalid provider %s token usage after one create',
      async (_label, input, output) => {
        const create = vi.fn().mockResolvedValue({
          content: [{ input: { content: 'ok' }, name: 'result', type: 'tool_use' }],
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: input,
            output_tokens: output,
          },
        });
        const client = {
          messages: {
            countTokens: vi.fn().mockResolvedValue({ input_tokens: 10 }),
            create,
          },
        };
        const route = {
          apiType: 'anthropic',
          channelId: 'anthropic-primary',
          model: 'claude-versioned',
          providerId: 'anthropic',
          routerId: 'anthropic',
        };
        const prepared = await anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          client as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
          } as any,
          undefined,
          {
            units: [
              { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 64, route },
        );

        await expect(prepared.execute()).rejects.toThrow('token usage is invalid');
        await expect(prepared.execute()).rejects.toThrow('already executed');
        expect(create).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      ['output cap', 10, 65, 'output exceeded maxOutputTokens'],
      ['Credits envelope', 1_000_000, 5, 'actual cost exceeded its envelope'],
    ])(
      'fails closed when actual usage exceeds the %s',
      async (_label, input, output, expectedError) => {
        const create = vi.fn().mockResolvedValue({
          content: [{ input: { content: 'ok' }, name: 'result', type: 'tool_use' }],
          usage: {
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            input_tokens: input,
            output_tokens: output,
          },
        });
        const route = {
          apiType: 'anthropic',
          channelId: 'anthropic-primary',
          model: 'claude-versioned',
          providerId: 'anthropic',
          routerId: 'anthropic',
        };
        const prepared = await anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          {
            messages: {
              countTokens: vi.fn().mockResolvedValue({ input_tokens: 10 }),
              create,
            },
          } as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
          } as any,
          undefined,
          {
            units: [
              { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 64, route },
        );

        await expect(prepared.execute()).rejects.toThrow(expectedError);
        expect(create).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      ['write', 1, 0],
      ['read', 0, 1],
    ])(
      'rejects provider-reported cache %s usage in the cache-disabled contract',
      async (_label, cacheCreation, cacheRead) => {
        const client = {
          messages: {
            countTokens: vi.fn().mockResolvedValue({ input_tokens: 10 }),
            create: vi.fn().mockResolvedValue({
              content: [{ input: { content: 'ok' }, name: 'result', type: 'tool_use' }],
              usage: {
                cache_creation_input_tokens: cacheCreation,
                cache_read_input_tokens: cacheRead,
                input_tokens: 9,
                output_tokens: 5,
              },
            }),
          },
        };
        const route = {
          apiType: 'anthropic',
          channelId: 'anthropic-primary',
          model: 'claude-versioned',
          providerId: 'anthropic',
          routerId: 'anthropic',
        };
        const prepared = await anthropicGenerateObject.prepareAnthropicGenerateObjectBounded(
          client as any,
          {
            messages: [{ content: 'Generate', role: 'user' }],
            model: 'claude-versioned',
            schema: { name: 'result', schema: { properties: {}, type: 'object' } },
          } as any,
          undefined,
          {
            units: [
              { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
              { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
            ],
          } as any,
          { maxOutputTokens: 64, route },
        );

        await expect(prepared.execute()).rejects.toThrow('cache usage is not allowed');
        expect(client.messages.create).toHaveBeenCalledTimes(1);
      },
    );
  });

  it('should throw error when neither tools nor schema is provided', async () => {
    const mockClient = {
      messages: {
        create: vi.fn(),
      },
    };

    const payload = {
      messages: [{ content: 'Generate data', role: 'user' as const }],
      model: 'claude-3-5-sonnet-20241022',
    };

    await expect(createAnthropicGenerateObject(mockClient as any, payload as any)).rejects.toThrow(
      'tools or schema is required',
    );
  });

  it('should strip trailing assistant messages for models without prefill support', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest({
      messages: [
        { content: 'Generate data', role: 'user' as const },
        { content: '...', role: 'assistant' as const },
        { content: '...', role: 'assistant' as const },
      ],
      model: 'claude-opus-5',
      schema: {
        name: 'extractor',
        schema: { properties: {}, type: 'object' as const },
      },
    } as any);

    expect(requestParams.messages).toEqual([{ content: 'Generate data', role: 'user' }]);
  });

  it('should key the prefill strip on config.requestModel when the logical id is unrecognized', async () => {
    // A custom logical id the parser doesn't recognize can map to a Claude 5
    // upstream id — the strip must follow the model actually sent.
    const { requestParams } = await buildAnthropicGenerateObjectRequest(
      {
        messages: [
          { content: 'Generate data', role: 'user' as const },
          { content: '...', role: 'assistant' as const },
        ],
        model: 'my-custom-router-model',
        schema: {
          name: 'extractor',
          schema: { properties: {}, type: 'object' as const },
        },
      } as any,
      { requestModel: 'claude-opus-5' },
    );

    expect(requestParams.messages).toEqual([{ content: 'Generate data', role: 'user' }]);
  });

  it('should use auto tool_choice and strict schema tools on Fable 5.1', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest({
      messages: [{ content: 'Generate a person object', role: 'user' as const }],
      model: 'claude-fable-5-1',
      schema: {
        description: 'Extract person information',
        name: 'person_extractor',
        schema: {
          properties: { age: { type: 'number' }, name: { type: 'string' } },
          required: ['name', 'age'],
          type: 'object' as const,
        },
      },
    } as any);

    expect(requestParams.tool_choice).toEqual({ type: 'auto' });
    expect(requestParams.tools).toEqual([
      expect.objectContaining({
        name: 'person_extractor',
        strict: true,
      }),
    ]);
    // auto tool_choice cannot force the call, so the prompt must ask for it
    expect(requestParams.system).toEqual([
      {
        text: 'You must respond by calling the `person_extractor` tool. Do not reply with plain text.',
        type: 'text',
      },
    ]);
  });

  it('should append the tool-use instruction after an existing system prompt on Fable 5.1', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest({
      messages: [
        { content: 'You are an extractor.', role: 'system' as const },
        { content: 'Generate a person object', role: 'user' as const },
      ],
      model: 'claude-fable-5-1',
      schema: {
        name: 'person_extractor',
        schema: { properties: { name: { type: 'string' } }, type: 'object' as const },
      },
    } as any);

    expect(requestParams.system).toEqual([
      {
        text: 'You are an extractor.\n\nYou must respond by calling the `person_extractor` tool. Do not reply with plain text.',
        type: 'text',
      },
    ]);
  });

  it('should key the Fable 5.1 tool_choice guard on config.requestModel', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest(
      {
        messages: [{ content: 'Generate a person object', role: 'user' as const }],
        model: 'my-custom-router-model',
        schema: {
          name: 'person_extractor',
          schema: { properties: { name: { type: 'string' } }, type: 'object' as const },
        },
      } as any,
      { requestModel: 'global.anthropic.claude-fable-5-1' },
    );

    expect(requestParams.tool_choice).toEqual({ type: 'auto' });
  });

  it('should keep forced tool_choice on Fable 5', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest({
      messages: [{ content: 'Generate a person object', role: 'user' as const }],
      model: 'claude-fable-5',
      schema: {
        name: 'person_extractor',
        schema: { properties: { name: { type: 'string' } }, type: 'object' as const },
      },
    } as any);

    expect(requestParams.tool_choice).toEqual({
      name: 'person_extractor',
      type: 'tool',
    });
    // forced tool_choice still works here, so no prompt instruction is injected
    expect(requestParams.system).toBeUndefined();
  });

  it('should use auto tool_choice for tools mode on Fable 5.1', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest({
      messages: [{ content: 'Call a tool', role: 'user' as const }],
      model: 'claude-fable-5-1',
      tools: [
        {
          function: {
            description: 'Get weather information',
            name: 'get_weather',
            parameters: {
              properties: { city: { type: 'string' } },
              required: ['city'],
              type: 'object' as const,
            },
          },
          type: 'function' as const,
        },
      ],
    } as any);

    expect(requestParams.tool_choice).toEqual({ type: 'auto' });
    expect(requestParams.system).toEqual([
      {
        text: 'You must respond by calling one of the provided tools. Do not reply with plain text.',
        type: 'text',
      },
    ]);
  });

  it('should still use auto tool_choice when the request model is an opaque mapped id', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest(
      {
        messages: [{ content: 'Generate', role: 'user' as const }],
        model: 'claude-fable-5-1',
        schema: {
          name: 'result',
          schema: {
            additionalProperties: false,
            properties: { title: { type: 'string' } },
            required: ['title'],
            type: 'object' as const,
          },
        },
      } as any,
      { requestModel: 'custom-deployment-id' },
    );

    expect(requestParams.tool_choice).toEqual({ type: 'auto' });
    expect((requestParams.tools?.[0] as any).strict).toBe(true);
  });

  it('should respect an explicit strict: false opt-out on Fable 5.1', async () => {
    const { requestParams } = await buildAnthropicGenerateObjectRequest({
      messages: [{ content: 'Generate', role: 'user' as const }],
      model: 'claude-fable-5-1',
      schema: {
        name: 'verdict',
        schema: {
          properties: { claim: { type: 'string' }, suggestion: { type: 'string' } },
          required: ['claim'],
          type: 'object' as const,
        },
        strict: false,
      },
    } as any);

    expect(requestParams.tool_choice).toEqual({ type: 'auto' });
    expect((requestParams.tools?.[0] as any).strict).toBe(false);
  });

  describe('use struct output schema', () => {
    it('should return structured data on successful API call', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { age: 30, name: 'John' },
                name: 'person_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate a person object', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          description: 'Extract person information',
          name: 'person_extractor',
          schema: {
            properties: { age: { type: 'number' }, name: { type: 'string' } },
            required: ['name', 'age'],
            type: 'object' as const,
          },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 64_000,
          messages: [{ content: 'Generate a person object', role: 'user' }],
          model: 'claude-3-5-sonnet-20241022',
          tool_choice: {
            name: 'person_extractor',
            type: 'tool',
          },
          tools: [
            {
              description: 'Extract person information',
              input_schema: {
                properties: {
                  age: { type: 'number' },
                  name: { type: 'string' },
                },
                required: ['name', 'age'],
                type: 'object',
              },
              name: 'person_extractor',
            },
          ],
        }),
        expect.objectContaining({}),
      );

      expect(result).toEqual({ age: 30, name: 'John' });
    });

    it('should allow schema structured output to require any tool', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { summary: 'Task completed', title: 'Done' },
                name: 'task_topic_handoff',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate a task handoff', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'task_topic_handoff',
          schema: {
            properties: { summary: { type: 'string' }, title: { type: 'string' } },
            required: ['title', 'summary'],
            type: 'object' as const,
          },
        },
      };

      const result = await createAnthropicGenerateObject(
        mockClient as any,
        payload,
        undefined,
        undefined,
        { schemaToolChoice: 'any' },
      );

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_choice: {
            type: 'any',
          },
        }),
        expect.objectContaining({}),
      );

      expect(result).toEqual({ summary: 'Task completed', title: 'Done' });
    });

    it('should ignore whitespace-only system prompts', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { status: 'ok' },
                name: 'status_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [
          { content: '   \n\t  ', role: 'system' as const },
          { content: 'Generate status', role: 'user' as const },
        ],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'status_extractor',
          schema: { properties: { status: { type: 'string' } }, type: 'object' as const },
        },
      };

      await createAnthropicGenerateObject(mockClient as any, payload);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: undefined,
        }),
        expect.any(Object),
      );
    });

    it('should handle system messages correctly', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { status: 'success' },
                name: 'status_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [
          { content: 'You are a helpful assistant', role: 'system' as const },
          { content: 'Generate status', role: 'user' as const },
        ],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'status_extractor',
          schema: { properties: { status: { type: 'string' } }, type: 'object' as const },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          system: [{ text: 'You are a helpful assistant', type: 'text' }],
        }),
        expect.any(Object),
      );

      expect(result).toEqual({ status: 'success' });
    });

    it('should handle options correctly', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { data: 'test' },
                name: 'data_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'data_extractor',
          schema: { properties: { data: { type: 'string' } }, type: 'object' as const },
        },
      };

      const options = {
        signal: new AbortController().signal,
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload, options);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          signal: options.signal,
        }),
      );

      expect(result).toEqual({ data: 'test' });
    });

    it('should forward configured request params when provided', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { data: 'test' },
                name: 'data_extractor',
                type: 'tool_use',
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'deepseek-v4-pro',
        schema: {
          name: 'data_extractor',
          schema: { properties: { data: { type: 'string' } }, type: 'object' as const },
        },
      };

      await createAnthropicGenerateObject(mockClient as any, payload, undefined, undefined, {
        requestParams: { thinking: { type: 'disabled' } },
      });

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: 'disabled' },
        }),
        expect.any(Object),
      );
    });

    it('should return undefined when no tool use found in response', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                text: 'Some text response without tool use',
                type: 'text',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'test_tool',
          schema: { type: 'object' },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload as any);

      expect(result).toBeUndefined();
    });

    it('should call onUsage callback with usage data', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { data: 'test' },
                name: 'test_tool',
                type: 'tool_use',
              },
            ],
            usage: {
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              input_tokens: 100,
              output_tokens: 50,
            },
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'test_tool',
          schema: { properties: { data: { type: 'string' } }, type: 'object' as const },
        },
      };

      const onUsage = vi.fn();
      const result = await createAnthropicGenerateObject(mockClient as any, payload, { onUsage });

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputCacheMissTokens: 100,
          totalInputTokens: 100,
          totalOutputTokens: 50,
          totalTokens: 150,
        }),
      );
      expect(result).toEqual({ data: 'test' });
    });

    it('should handle complex nested schemas', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: {
                  metadata: {
                    created: '2024-01-01',
                  },
                  user: {
                    name: 'Alice',
                    profile: {
                      age: 25,
                      preferences: ['music', 'sports'],
                    },
                  },
                },
                name: 'user_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate complex user data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          description: 'Extract complex user information',
          name: 'user_extractor',
          schema: {
            properties: {
              metadata: { type: 'object' },
              user: {
                properties: {
                  name: { type: 'string' },
                  profile: {
                    properties: {
                      age: { type: 'number' },
                      preferences: { items: { type: 'string' }, type: 'array' },
                    },
                    type: 'object',
                  },
                },
                type: 'object',
              },
            },
            type: 'object' as const,
          },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload);

      expect(result).toEqual({
        metadata: {
          created: '2024-01-01',
        },
        user: {
          name: 'Alice',
          profile: {
            age: 25,
            preferences: ['music', 'sports'],
          },
        },
      });
    });
  });

  describe('tools calling', () => {
    it('should handle tools calling mode with multiple tools', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { city: 'New York', unit: 'celsius' },
                name: 'get_weather',
                type: 'tool_use',
              },
              {
                input: { timezone: 'America/New_York' },
                name: 'get_time',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'What is the weather and time in New York?', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        tools: [
          {
            function: {
              description: 'Get weather information',
              name: 'get_weather',
              parameters: {
                properties: {
                  city: { type: 'string' },
                  unit: { type: 'string' },
                },
                required: ['city'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
          {
            function: {
              description: 'Get current time',
              name: 'get_time',
              parameters: {
                properties: {
                  timezone: { type: 'string' },
                },
                required: ['timezone'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload as any);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 64_000,
          messages: [{ content: 'What is the weather and time in New York?', role: 'user' }],
          model: 'claude-3-5-sonnet-20241022',
          tool_choice: {
            type: 'any',
          },
          tools: [
            {
              description: 'Get weather information',
              input_schema: {
                properties: {
                  city: { type: 'string' },
                  unit: { type: 'string' },
                },
                required: ['city'],
                type: 'object',
              },
              name: 'get_weather',
            },
            {
              description: 'Get current time',
              input_schema: {
                properties: {
                  timezone: { type: 'string' },
                },
                required: ['timezone'],
                type: 'object',
              },
              name: 'get_time',
            },
          ],
        }),
        expect.objectContaining({}),
      );

      expect(result).toEqual([
        { arguments: { city: 'New York', unit: 'celsius' }, name: 'get_weather' },
        { arguments: { timezone: 'America/New_York' }, name: 'get_time' },
      ]);
    });

    it('should handle tools calling mode with single tool', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { a: 5, b: 3, operation: 'add' },
                name: 'calculate',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Add 5 and 3', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        tools: [
          {
            function: {
              description: 'Perform mathematical calculation',
              name: 'calculate',
              parameters: {
                properties: {
                  a: { type: 'number' },
                  b: { type: 'number' },
                  operation: { type: 'string' },
                },
                required: ['operation', 'a', 'b'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload as any);

      expect(result).toEqual([{ arguments: { a: 5, b: 3, operation: 'add' }, name: 'calculate' }]);
    });
  });

  it('should propagate API errors correctly', async () => {
    const apiError = new Error('API Error: Model not found');

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue(apiError),
      },
    };

    const payload = {
      messages: [{ content: 'Generate data', role: 'user' as const }],
      model: 'claude-3-5-sonnet-20241022',
      schema: {
        name: 'test_tool',
        schema: { type: 'object' },
      },
    };

    await expect(createAnthropicGenerateObject(mockClient as any, payload as any)).rejects.toThrow(
      'API Error: Model not found',
    );
  });

  it('should handle abort signals correctly', async () => {
    const apiError = new Error('Request was cancelled');
    apiError.name = 'AbortError';

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue(apiError),
      },
    };

    const payload = {
      messages: [{ content: 'Generate data', role: 'user' as const }],
      model: 'claude-3-5-sonnet-20241022',
      schema: {
        name: 'test_tool',
        schema: { type: 'object' },
      },
    };

    const options = {
      signal: new AbortController().signal,
    };

    await expect(
      createAnthropicGenerateObject(mockClient as any, payload as any, options),
    ).rejects.toThrow();
  });
});
