import { describe, expect, it } from 'vitest';

import { serverMessagesEngine } from '@/server/modules/Mecha/ContextEngineering';

import { fitGroupContextBudget } from './groupContextBudget';

describe('fitGroupContextBudget', () => {
  const system = { content: 'Follow the group rules.', role: 'system' as const };
  const latest = { content: 'Continue my current task.', id: 'latest', role: 'user' as const };
  const old = { content: 'Old historical text. '.repeat(4000), id: 'old', role: 'user' as const };
  const userIds = ['old', 'latest'];

  it('keeps small requests unchanged', () => {
    const messages = [system, latest];
    expect(fitGroupContextBudget(messages, [], 4000, userIds).messages).toBe(messages);
  });

  it('evicts whole old turns, retaining system rules and the active tool exchange', () => {
    const call = {
      content: '',
      role: 'assistant' as const,
      tool_calls: [
        { function: { arguments: '{}', name: 'read' }, id: 'tool-1', type: 'function' as const },
      ],
    };
    const result = { content: 'File excerpt', role: 'tool' as const, tool_call_id: 'tool-1' };
    const messages = [
      system,
      old,
      { content: 'old answer', role: 'assistant' as const },
      latest,
      call,
      result,
    ];
    const fitted = fitGroupContextBudget(messages, [], 4000, userIds);
    expect(fitted.messages).toEqual([system, latest, call, result]);
    expect(fitted.removedMessages).toBe(2);
    expect(messages).toHaveLength(6);
  });

  it('counts injected tool schemas and refuses to truncate an oversized active task', () => {
    expect(() =>
      fitGroupContextBudget([system, latest], [{ description: old.content }], 4000, userIds),
    ).toThrow('当前任务');
    expect(() => fitGroupContextBudget([system, old], [], 4000, userIds)).toThrow('当前任务');
  });

  it('reserves explicitly requested output tokens', () => {
    expect(() => fitGroupContextBudget([system, latest], [], 4000, userIds, 4000)).toThrow(
      '当前任务',
    );
  });

  it('counts provider-format tool arguments, not just visible text', () => {
    expect(() =>
      fitGroupContextBudget(
        [
          latest,
          {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                function: { arguments: old.content, name: 'write' },
                id: 'call',
                type: 'function',
              },
            ],
          },
        ],
        [],
        4000,
        userIds,
      ),
    ).toThrow('当前任务');
  });

  it('preserves the true current task when peers and callbacks become provider user messages', () => {
    const peer = { content: '<speaker name="peer" />result', id: 'peer', role: 'user' as const };
    const callback = {
      content: '<task_result>done</task_result>',
      id: 'callback',
      role: 'user' as const,
    };
    expect(
      fitGroupContextBudget([old, latest, peer, callback], [], 4000, userIds).messages,
    ).toEqual([latest, peer, callback]);
    expect(() => fitGroupContextBudget([old, peer, callback], [], 4000, ['old'])).toThrow(
      '当前任务',
    );
  });

  it('does not guess an absent true task anchor from transformed roles', () => {
    expect(() => fitGroupContextBudget([old, latest], [], 4000, [])).toThrow('当前任务');
  });

  it('does not mistake inline image bytes for text tokens', () => {
    const imageMessage = {
      ...latest,
      content: [
        {
          type: 'image_url' as const,
          image_url: { url: `data:image/png;base64,${'a'.repeat(500_000)}` },
        },
      ],
    };
    expect(fitGroupContextBudget([imageMessage], [], 32_000, userIds).messages).toEqual([
      imageMessage,
    ]);
  });

  it('uses out-of-band identities after the real context engine strips wire IDs', async () => {
    let sourceIds: (string | undefined)[] = [];
    const wireMessages = await serverMessagesEngine({
      messages: [old, latest] as any,
      model: 'gpt-4',
      provider: 'openai',
      onMessageSources: (ids: (string | undefined)[]) => {
        sourceIds = ids;
      },
    });
    expect(wireMessages.every((message) => !('id' in message))).toBe(true);
    const fitted = fitGroupContextBudget(wireMessages, [], 4000, userIds, 0, sourceIds);
    expect(fitted.messages.some((message) => message.content === latest.content)).toBe(true);
    expect(fitted.messages.some((message) => message.content === old.content)).toBe(false);
  });
});
