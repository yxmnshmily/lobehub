import { loadModels } from '@lobechat/business-model-bank/model-config';
import deepseek from 'model-bank/deepseek';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { convertOpenAIUsage } from '../core/usageConverters/openai';
import { getExactModelPricing, getModelPricing } from './getModelPricing';

afterEach(() => vi.useRealTimers());

describe('DeepSeek official pricing through runtime usage settlement', () => {
  it.each([
    ['2026-09-13T10:00:00+08:00', 1], // Sunday
    ['2026-09-14T08:59:59+08:00', 1],
    ['2026-09-14T09:00:00+08:00', 2],
    ['2026-09-14T11:59:59+08:00', 2],
    ['2026-09-14T12:00:00+08:00', 1],
    ['2026-09-14T14:00:00+08:00', 2],
    ['2026-09-14T17:59:59+08:00', 2],
    ['2026-09-14T18:00:00+08:00', 1],
    ['2026-09-19T10:00:00+08:00', 1], // Saturday
  ])('settles canonical and legacy Flash usage at %s', async (time, multiplier) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(time));
    for (const model of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      const pricing = await getModelPricing(model, 'deepseek');
      const usage = convertOpenAIUsage(
        {
          completion_tokens: 1000,
          prompt_tokens: 2000,
          prompt_tokens_details: { cached_tokens: 1500 },
          total_tokens: 3000,
        },
        { model, pricing, provider: 'deepseek' },
      );
      expect(pricing?.currency).toBe('CNY');
      // CNY 0.00453 / 7.12 USD, rounded up once to the existing micro-dollar credit.
      expect(usage.cost).toBe(multiplier === 1 ? 0.000637 : 0.001273);
    }
  });

  it('keeps Pro on its own rate after September 14 and resolves each lookup afresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T12:00:00+08:00'));
    const idle = await getExactModelPricing('deepseek-v4-pro', 'deepseek');
    vi.setSystemTime(new Date('2026-09-14T14:00:00+08:00'));
    const peak = await getExactModelPricing('deepseek-v4-pro', 'deepseek');
    expect(idle?.units.map((unit) => unit.strategy === 'fixed' && unit.rate)).toEqual([
      0.15, 4.5, 13.5,
    ]);
    expect(peak?.units.map((unit) => unit.strategy === 'fixed' && unit.rate)).toEqual([0.3, 9, 27]);
    expect(idle?.units.map((unit) => unit.strategy === 'fixed' && unit.rate)).toEqual([
      0.15, 4.5, 13.5,
    ]);
  });

  it('does not mutate source cards or adjust other providers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T12:00:00+08:00'));
    const originals = structuredClone(deepseek);
    const idle = await loadModels();
    vi.setSystemTime(new Date('2026-09-14T14:00:00+08:00'));
    const peak = await loadModels();
    expect(peak.filter((model) => model.providerId !== 'deepseek')).toEqual(
      idle.filter((model) => model.providerId !== 'deepseek'),
    );
    expect(deepseek).toEqual(originals);
  });
});
