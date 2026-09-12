import { describe, expect, it } from 'vitest';

import { parseAgentMessageQuote } from './messageQuote';

describe('agent reply references', () => {
  it('separates a persisted real message reference from B’s answer', () => {
    expect(parseAgentMessageQuote('<group_reply ref="msg%5FA" />\n我来检查你的文案')).toEqual({
      content: '我来检查你的文案',
      referenceId: 'msg_A',
    });
  });

  it('hides the incomplete leading marker during streaming', () => {
    expect(parseAgentMessageQuote('<group_reply ref="msg')).toEqual({ content: '' });
  });

  it.each([
    '正常回复',
    '示例：<group_reply ref="msg_A" />',
    '```xml\n<group_reply ref="msg_A" />\n```',
    '<group_reply ref="https%3A%2F%2Fexample.com" />',
    '<group_reply ref="msg%ZZ" />',
  ])('does not treat ordinary text or unsafe identifiers as a reply: %s', (content) => {
    expect(parseAgentMessageQuote(content)).toEqual({ content });
  });
});
