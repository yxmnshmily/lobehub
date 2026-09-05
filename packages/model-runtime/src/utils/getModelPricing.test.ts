import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadModelsMock = vi.hoisted(() => vi.fn());

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

const pricingModule = await import('./getModelPricing');
const { getExactModelPricing, getModelPricing } = pricingModule;
const publicApi = await import('../index');

beforeEach(() => {
  vi.clearAllMocks();
  loadModelsMock.mockResolvedValue([
    {
      id: 'gpt-4o',
      pricing: {
        units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
      },
      providerId: 'openai',
    },
    {
      id: 'gpt-4o',
      pricing: {
        units: [{ name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' }],
      },
      providerId: 'other-provider',
    },
  ]);
});

describe('getExactModelPricing', () => {
  it('is available through the model-runtime package API', () => {
    expect(publicApi.getExactModelPricing).toBe(getExactModelPricing);
  });

  it('returns pricing only for the exact provider and model pair', async () => {
    const result = await getExactModelPricing('gpt-4o', 'openai');

    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('does not fall back to a same-name model from another provider', async () => {
    const result = await getExactModelPricing('gpt-4o', 'missing-provider');

    expect(result).toBeUndefined();
  });

  it.each([
    { model: undefined, provider: 'openai' },
    { model: '', provider: 'openai' },
    { model: '   ', provider: 'openai' },
    { model: 'gpt-4o', provider: undefined },
    { model: 'gpt-4o', provider: '' },
    { model: 'gpt-4o', provider: '   ' },
  ])('fails closed for an incomplete provider-model pair: %o', async ({ model, provider }) => {
    await expect(getExactModelPricing(model, provider)).resolves.toBeUndefined();
  });

  it('uses the requested pricing context for the exact lookup', async () => {
    await getExactModelPricing('gpt-4o', 'openai', { plan: 'premium', scope: 'personal' });

    expect(loadModelsMock).toHaveBeenCalledWith({
      pricingContext: { plan: 'premium', scope: 'personal' },
    });
  });
});

describe('getModelPricing', () => {
  it('should use injected LobeHub pricing before same-id fallback pricing', async () => {
    loadModelsMock.mockResolvedValue([
      {
        id: 'injected-only-model',
        pricing: {
          units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
        },
        providerId: 'openai',
      },
      {
        id: 'injected-only-model',
        pricing: {
          units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
        },
        providerId: 'lobehub',
      },
    ]);

    const result = await getModelPricing('injected-only-model', 'lobehub');

    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('should propagate loadModels errors instead of falling back to static defaults', async () => {
    loadModelsMock.mockRejectedValue(new Error('model config missing'));

    await expect(getModelPricing('injected-only-model', 'lobehub')).rejects.toThrow(
      'model config missing',
    );
  });

  it('should use provider pricing when the provider match exists', async () => {
    const result = await getModelPricing('gpt-4o', 'openai');

    expect(result).toEqual({
      units: [{ name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' }],
    });
  });

  it('should pass explicit pricing context to loadModels', async () => {
    await getModelPricing('gpt-4o', 'openai', { plan: 'premium', scope: 'personal' });

    expect(loadModelsMock).toHaveBeenCalledWith({
      pricingContext: { plan: 'premium', scope: 'personal' },
    });
  });
});
