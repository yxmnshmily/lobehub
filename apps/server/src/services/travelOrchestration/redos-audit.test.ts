import { describe, expect, it } from 'vitest';

import { routeTravelRequest } from './index';

const ITERATIONS_PER_SIZE = 101;
const MAX_INPUT_LENGTH = 20_000;

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const canonicalIntents = ['copy', 'image', 'video', 'document'] as const;

const repeatToLength = (fragment: string, length: number) =>
  fragment.repeat(Math.ceil(length / fragment.length)).slice(0, length);

const worstCaseBuilders = [
  [
    'unterminated nested citation',
    (length: number) =>
      `引用内容：“${repeatToLength('客人说‘不要修改制作视频号WordPDF链接', length)}`.slice(
        0,
        length,
      ),
  ],
  [
    'deep alternating quote nesting',
    (length: number) => repeatToLength("“‘《【\"'不要修改制作链接视频号WordPDF'】》’”", length),
  ],
  [
    'repeated Markdown fences',
    (length: number) => repeatToLength('```不要修改制作链接视频号WordPDF```', length),
  ],
  [
    'single long URL',
    (length: number) =>
      `资料：https://example.com/${repeatToLength('不要修改制作链接视频号WordPDF', length)}`.slice(
        0,
        length,
      ),
  ],
  [
    'repeated routing keywords',
    (length: number) => repeatToLength('不要修改制作链接视频号WordPDF，', length),
  ],
  [
    'isolated surrogate pairs',
    (length: number) => repeatToLength('\uD800x\uDC00不要修改制作链接视频号WordPDF，', length),
  ],
  [
    'unterminated nested JSON strings',
    (length: number) =>
      repeatToLength('{"outer":{"value":"不要修改制作链接视频号WordPDF\\"', length),
  ],
  [
    'unterminated HTML blocks',
    (length: number) =>
      repeatToLength('<script data-value="不要修改制作链接视频号WordPDF">', length),
  ],
] as const;

const measureStableBatch = (message: string) => {
  for (let warmup = 0; warmup < 3; warmup++) routeTravelRequest({ members, message });

  const startedAt = performance.now();
  let firstResult: ReturnType<typeof routeTravelRequest> | undefined;
  let firstSerialized = '';

  for (let iteration = 0; iteration < ITERATIONS_PER_SIZE; iteration++) {
    const result = routeTravelRequest({ members, message });
    const serialized = JSON.stringify(result);
    if (iteration === 0) {
      firstResult = result;
      firstSerialized = serialized;
    } else if (serialized !== firstSerialized) {
      throw new Error(`non-deterministic result at iteration ${iteration}`);
    }
  }

  if (!firstResult) throw new Error('stress batch did not execute');
  return {
    duration: performance.now() - startedAt,
    result: firstResult,
    serialized: firstSerialized,
  };
};

describe('travel orchestration ReDoS and worst-case input audit', () => {
  it.each(worstCaseBuilders)('keeps %s deterministic, bounded, and near-linear', (_, build) => {
    const shortMessage = build(MAX_INPUT_LENGTH / 2);
    const longMessage = build(MAX_INPUT_LENGTH);
    const heapBefore = process.memoryUsage().heapUsed;
    const shortRun = measureStableBatch(shortMessage);
    const longRun = measureStableBatch(longMessage);
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

    for (const [label, run] of [
      ['10k', shortRun],
      ['20k', longRun],
    ] as const) {
      expect(run.result.mode, `${label} input unexpectedly failed with complete members`).not.toBe(
        'unavailable',
      );
      expect(
        run.result.intents.every((intent) => canonicalIntents.includes(intent)),
        `${label} input returned an unsupported intent`,
      ).toBe(true);
      expect(new Set(run.result.intents).size, `${label} input returned duplicate intents`).toBe(
        run.result.intents.length,
      );
      const positions = run.result.intents.map((intent) => canonicalIntents.indexOf(intent));
      expect(positions, `${label} input broke canonical intent order`).toEqual(
        [...positions].sort((left, right) => left - right),
      );
      expect(run.serialized.length, `${label} output retained unbounded input data`).toBeLessThan(
        1024,
      );
    }

    expect(shortMessage).toHaveLength(MAX_INPUT_LENGTH / 2);
    expect(longMessage).toHaveLength(MAX_INPUT_LENGTH);
    expect(shortRun.duration + longRun.duration).toBeLessThan(5000);
    expect(longRun.duration).toBeLessThan(shortRun.duration * 8 + 250);
    expect(heapGrowth).toBeLessThan(128 * 1024 * 1024);
  });
});
