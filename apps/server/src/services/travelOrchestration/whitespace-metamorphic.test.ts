import { describe, expect, it } from 'vitest';

import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const expectedAllIntentRoute = {
  intents: ['copy', 'image', 'video', 'document'],
  memberIds: ['copy-agent', 'image-agent', 'video-agent', 'document-agent'],
  mode: 'delegate',
} as const;

const separatorVariants = [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['consecutive blank lines', '\n\n\n'],
  ['Tab', '\t'],
  ['full-width spaces', '　'],
  ['Chinese punctuation', '，；'],
  ['English punctuation', ',;'],
  ['zero-width controls', '\u200B\u2060'],
  ['bidi controls', '\u202E\u2066\u2069'],
] as const;

describe('travel orchestration whitespace metamorphic contract', () => {
  it.each(separatorVariants)(
    'keeps the same canonical route with %s separators',
    (_, separator) => {
      const message = ['整理旅游文档', '制作旅游视频', '生成旅游图片', '写旅游文案'].join(
        separator,
      );

      expect(routeTravelRequest({ members, message })).toEqual(expectedAllIntentRoute);
    },
  );

  it.each([
    ['LF', '写旅游文案\n不要生成视频\n引用内容：“生成视频并整理文档”'],
    ['CRLF', '写旅游文案\r\n不要生成视频\r\n```\r\n生成图片并整理文档\r\n```'],
    [
      'consecutive blank lines',
      '写旅游文案\n\n不要生成视频\n\n资料：https://example.com/生成图片制作视频整理文档',
    ],
  ])('does not glue a negation to next-line %s pseudo-instructions', (_, message) => {
    expect(routeTravelRequest({ members, message })).toEqual({
      intents: ['copy'],
      memberIds: ['copy-agent'],
      mode: 'delegate',
    });
  });

  it.each([
    ['LF', '先写文案\n再做封面'],
    ['CRLF', '先写文案\r\n再做封面'],
    ['consecutive blank lines', '先写文案\n\n\n再做封面'],
  ])('still recognizes a legitimate cross-line copy and image request with %s', (_, message) => {
    expect(routeTravelRequest({ members, message })).toEqual({
      intents: ['copy', 'image'],
      memberIds: ['copy-agent', 'image-agent'],
      mode: 'delegate',
    });
  });

  it('keeps long metamorphic requests deterministic with near-linear growth', () => {
    const durations = [10_000, 20_000].map((neutralLength) => {
      const message = `${'背景'.repeat(neutralLength / 2)}\u200B\u202E\r\n生成旅游图片\t写旅游文案`;
      const startedAt = performance.now();
      const first = createTravelToolDispatchPolicy({ members, message });

      for (let iteration = 0; iteration < 5; iteration++) {
        expect(createTravelToolDispatchPolicy({ members, message })).toEqual(first);
      }
      expect(first.mode).toBe('delegate');
      if (first.mode !== 'delegate') throw new Error('expected delegate policy');
      expect(first.route).toEqual({
        intents: ['copy', 'image'],
        memberIds: ['copy-agent', 'image-agent'],
        mode: 'delegate',
      });
      expect(first.policy.steps).toHaveLength(2);

      return performance.now() - startedAt;
    });

    expect(durations[0] + durations[1]).toBeLessThan(2000);
    expect(durations[1]).toBeLessThan(durations[0] * 6 + 200);
  });
});
