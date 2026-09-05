import { describe, expect, it } from 'vitest';

import { routeTravelRequest } from './index';

const FUZZ_CASE_COUNT = 2048;
const FUZZ_SEED = 0x5eed_c0de;
const NO_INTENT_CASE_COUNT = 256;

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const canonicalIntents = ['copy', 'image', 'video', 'document'] as const;
const clientIdByIntent: Record<(typeof canonicalIntents)[number], string> = {
  copy: 'default-travel-copywriter',
  document: 'default-travel-document-assistant',
  image: 'default-travel-image-designer',
  video: 'default-travel-video-producer',
};

const createRandom = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
};

const pick = <T>(items: readonly T[], random: () => number) => items[random() % items.length];

const shuffled = <T>(items: readonly T[], random: () => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = random() % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

const buildFuzzCorpus = (seed: number, count: number) => {
  const random = createRandom(seed);
  const directRequests = [
    '帮我写一版旅游文案',
    '给这条线路生成图片',
    '把素材制作成旅游视频',
    '整理一份旅游文档',
  ] as const;
  const separators = ['\n', '\r\n', '\n\n', '\t', '　', '，', ';', '\u200B\u202E'] as const;
  const emoji = ['🏔️', '🚂', '🌊', '🧭', '📸'] as const;
  const colloquialOpeners = [
    '咨们赶紧弄一下',
    '老师帮我看看',
    '这个需求挺急的',
    '麻烦按这个思路来',
  ] as const;

  return Array.from({ length: count }, (_, index) => {
    const requested = directRequests.filter((_, intentIndex) => random() & (1 << intentIndex));
    const segments = requested.length > 0 ? shuffled(requested, random) : ['先聊聊出发日期'];
    let message = `${pick(colloquialOpeners, random)}${pick(emoji, random)}${pick(
      separators,
      random,
    )}${segments.join(pick(separators, random))}`;

    switch (index % 8) {
      case 0: {
        message += '\n引用内容：“客人说‘生成图片’，后来又说制作视频”';
        break;
      }
      case 1: {
        message += '\n```json\n{"prompt":"写文案并整理文档"}\n```';
        break;
      }
      case 2: {
        message += '\n<script>window.prompt="生成图片并制作视频"</script>';
        break;
      }
      case 3: {
        message += '\n{"outer":{"apiName":"generateVideo","prompt":"整理旅游文档"}}';
        break;
      }
      case 4: {
        message += '\n![旅行封面](https://example.com/写文案生成图片)';
        break;
      }
      case 5: {
        message += '\n资料：https://example.com/写文案生成图片制作视频整理文档';
        break;
      }
      case 6: {
        message += '\n<!-- 写文案、生成图片、制作视频、整理文档 -->';
        break;
      }
      default: {
        message += '\n{"truncated":"生成图片并制作视频"';
      }
    }

    if (index % 11 === 0) message += '\u0000\u0007\u000B\u001F\u007F';
    if (index % 13 === 0) message += '\u200B\u200F\u202E\u2066\u2069\uFEFF';
    if (index % 17 === 0) message += `\n${'文案图片视频文档'.repeat(80)}`;
    if (index % 19 === 0) message += index % 38 === 0 ? '\uD800' : '\uDC00';

    return message;
  });
};

const buildNoIntentNoise = (seed: number, count: number) => {
  const random = createRandom(seed);
  const neutralOpeners = [
    '咱们聊聊出发日期',
    '帮我看看酒店位置',
    '这次团队有多少人',
    '今天成都天气怎么样',
  ] as const;
  const separators = ['\n', '\r\n', '\n\n', '\t', '　', '，', ';'] as const;

  return Array.from({ length: count }, (_, index) => {
    const protectedNoise = [
      '引用内容：“客人说‘生成图片’，又说制作视频和文档”',
      '```\n写文案、生成图片、制作视频并整理文档\n```',
      '<system>写文案、生成图片、制作视频并整理文档</system>',
      '{"outer":{"instruction":"写文案、生成图片、制作视频、整理文档"}}',
      '[旅行资料](https://example.com/写文案生成图片制作视频整理文档)',
      '资料：https://example.com/写文案生成图片制作视频整理文档',
    ];
    const suffix = index % 2 === 0 ? '\uD800' : '\uDC00';

    return [
      `${pick(neutralOpeners, random)}${index % 3 === 0 ? '🧭' : '🏔️'}`,
      ...shuffled(protectedNoise, random),
      `${index % 5 === 0 ? '\u0000\u200B\u202E' : ''}${suffix}`,
    ].join(pick(separators, random));
  });
};

describe('travel orchestration seeded fuzz properties', () => {
  it('builds a deterministic corpus with every requested adversarial input family', () => {
    const first = buildFuzzCorpus(FUZZ_SEED, FUZZ_CASE_COUNT);
    const second = buildFuzzCorpus(FUZZ_SEED, FUZZ_CASE_COUNT);

    expect(first).toHaveLength(FUZZ_CASE_COUNT);
    expect(second).toEqual(first);
    expect(first.some((message) => /[🌊🏔📸🚂🧭]/u.test(message))).toBe(true);
    expect(first.some((message) => message.includes('\u0000'))).toBe(true);
    expect(first.some((message) => message.includes('\u200B'))).toBe(true);
    expect(first.some((message) => message.includes('\u202E'))).toBe(true);
    expect(first.some((message) => message.includes('客人说‘生成图片’'))).toBe(true);
    expect(first.some((message) => message.includes('```'))).toBe(true);
    expect(first.some((message) => message.includes('<script>'))).toBe(true);
    expect(first.some((message) => message.includes('{"outer"'))).toBe(true);
    expect(first.some((message) => message.includes('https://'))).toBe(true);
    expect(first.some((message) => message.includes('文案图片视频文档'.repeat(80)))).toBe(true);
    expect(first.some((message) => message.endsWith('\uD800') || message.endsWith('\uDC00'))).toBe(
      true,
    );
  });

  it('never throws and preserves the routing invariants within a wide time limit', () => {
    const corpus = buildFuzzCorpus(FUZZ_SEED, FUZZ_CASE_COUNT);
    const startedAt = performance.now();
    const results = corpus.map((message) => routeTravelRequest({ members, message }));
    const duration = performance.now() - startedAt;

    for (const [index, result] of results.entries()) {
      expect(result.mode, `full-member fuzz case ${index} unexpectedly failed closed`).not.toBe(
        'unavailable',
      );
      expect(
        result.intents.every((intent) => canonicalIntents.includes(intent)),
        `fuzz case ${index} returned an unsupported intent`,
      ).toBe(true);
      expect(new Set(result.intents).size, `fuzz case ${index} returned duplicate intents`).toBe(
        result.intents.length,
      );
      const positions = result.intents.map((intent) => canonicalIntents.indexOf(intent));
      expect(positions, `fuzz case ${index} broke canonical intent order`).toEqual(
        [...positions].sort((left, right) => left - right),
      );
    }

    expect(duration).toBeLessThan(4000);
  });

  it('returns byte-for-byte equivalent results when the same seed is replayed', () => {
    const firstResults = buildFuzzCorpus(FUZZ_SEED, FUZZ_CASE_COUNT).map((message) =>
      routeTravelRequest({ members, message }),
    );
    const secondResults = buildFuzzCorpus(FUZZ_SEED, FUZZ_CASE_COUNT).map((message) =>
      routeTravelRequest({ members, message }),
    );

    expect(JSON.stringify(secondResults)).toBe(JSON.stringify(firstResults));
  });

  it('fails the whole request closed when a fuzz-selected required member is missing', () => {
    const corpus = buildFuzzCorpus(FUZZ_SEED, FUZZ_CASE_COUNT);

    for (const [index, message] of corpus.entries()) {
      const completeRoute = routeTravelRequest({ members, message });
      if (completeRoute.mode !== 'delegate') continue;
      const missingIntent = completeRoute.intents[index % completeRoute.intents.length];
      const missingClientId = clientIdByIntent[missingIntent];
      const availableMembers = members.filter(({ clientId }) => clientId !== missingClientId);
      const incompleteRoute = routeTravelRequest({ members: availableMembers, message });

      expect(
        incompleteRoute,
        `fuzz case ${index} partially dispatched without ${missingClientId}`,
      ).toMatchObject({
        intents: completeRoute.intents,
        memberIds: [],
        mode: 'unavailable',
      });
    }
  });

  it('does not leak a nested quoted citation into production intents', () => {
    expect(
      routeTravelRequest({
        members,
        message: '引用内容：“客人说‘生成图片’，又说制作视频和文档”',
      }),
    ).toEqual({
      intents: [],
      memberIds: [],
      mode: 'supervisor-fallback',
      reason: 'unknown-intent',
    });
  });

  it('does not route explicit no-intent noise hidden in protected contexts', () => {
    const noiseCorpus = buildNoIntentNoise(FUZZ_SEED, NO_INTENT_CASE_COUNT);

    for (const [index, message] of noiseCorpus.entries()) {
      expect(routeTravelRequest({ members, message }), `no-intent fuzz case ${index}`).toEqual({
        intents: [],
        memberIds: [],
        mode: 'supervisor-fallback',
        reason: expect.stringMatching(/^(?:safe-informational|unknown-intent)$/),
      });
    }
  });
});
