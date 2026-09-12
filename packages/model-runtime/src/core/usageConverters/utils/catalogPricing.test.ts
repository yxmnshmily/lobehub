import google from 'model-bank/google';
import openai from 'model-bank/openai';
import qwen from 'model-bank/qwen';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';
import { computeVideoCost } from './computeVideoCost';

describe('official catalog pricing conditions', () => {
  it.each([
    ['720x1280', 1.2],
    ['1280x720', 1.2],
    ['1024x1792', 2],
    ['1792x1024', 2],
    ['1080x1920', 2.8],
    ['1920x1080', 2.8],
  ] as const)('Sora Pro %s prices four seconds without enabling the model', (size, totalCost) => {
    const pricing = openai.find((model) => model.id === 'sora-2-pro')!.pricing!;
    expect(computeVideoCost(pricing, 0, { duration: 4, size })?.totalCost).toBeCloseTo(totalCost);
  });
  it.each([
    ['veo-3.1-generate-preview', '720p', 3.2],
    ['veo-3.1-generate-preview', '1080p', 3.2],
    ['veo-3.1-generate-preview', '4k', 4.8],
    ['veo-3.1-fast-generate-preview', '720p', 0.8],
    ['veo-3.1-fast-generate-preview', '1080p', 0.96],
    ['veo-3.1-fast-generate-preview', '4k', 2.4],
  ] as const)('%s %s charges an eight-second output correctly', (id, resolution, totalCost) => {
    const pricing = google.find((model) => model.id === id)!.pricing!;
    expect(computeVideoCost(pricing, 0, { duration: 8, resolution })?.totalCost).toBeCloseTo(
      totalCost,
    );
  });

  it.each(['wan2.7-t2v', 'wan2.7-t2v-2026-04-25'])('%s applies the domestic 720p rate', (id) => {
    const pricing = qwen.find((model) => model.id === id)!.pricing!;
    // Five seconds at CNY 0.60 = CNY 3 = USD 0.4213483146 at the billing baseline.
    expect(
      computeVideoCost(pricing, 0, { duration: 5, resolution: '720P' })?.totalCost,
    ).toBeCloseTo(0.4213483146);
  });

  it('uses the long-context Qwen tier for both input and output, without assuming an account discount', () => {
    const pricing = qwen.find((model) => model.id === 'qwen3.7-plus')!.pricing!;
    const result = computeChatCost(pricing, {
      totalInputTokens: 300000,
      totalOutputTokens: 1000,
      totalTokens: 301000,
    });
    // CNY 1.8 input + 0.024 output = 1.824 / 7.12 USD; one final credit rounding.
    expect(result?.totalCredits).toBe(256180);
  });
});
