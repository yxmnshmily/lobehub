import type { AiFullModelCard, AiModelType } from 'model-bank';
import { loadModels as loadModelBankModels, ModelProvider } from 'model-bank';

interface LobeHubModelConfig {
  models: AiFullModelCard[];
  planCardModels: string[];
  updatedAt?: string;
  version: number;
}

export interface LobeHubModelPricingContext {
  plan: string;
  scope: 'personal';
}

export interface LobeHubModelPricingOptions {
  pricingContext?: LobeHubModelPricingContext;
}

const getDefaultLobeHubModelConfig = (): LobeHubModelConfig => ({
  models: [],
  planCardModels: [],
  version: 1,
});

const loadLobeHubModelConfig = async (): Promise<LobeHubModelConfig> =>
  getDefaultLobeHubModelConfig();

export const loadModels = async (_options?: LobeHubModelPricingOptions) => {
  // Resolve per lookup, not at module load: Beijing weekdays 09–12 and 14–18
  // are billed at twice the catalog's off-peak base rate.
  // https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
  const beijing = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const day = beijing.getUTCDay();
  const hour = beijing.getUTCHours();
  const peak = day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
  const models = await loadModelBankModels({
    providerLoaders: {
      [ModelProvider.LobeHub]: loadLobeHubModels,
    },
  });

  if (!peak) return models;

  return models.map((model) => {
    if (
      model.providerId !== ModelProvider.DeepSeek ||
      ![
        'deepseek-flash',
        'deepseek-v4-flash',
        'deepseek-v4-flash-vision-exp',
        'deepseek-v4-pro',
      ].includes(model.id) ||
      model.pricing?.currency !== 'CNY'
    )
      return model;

    return {
      ...model,
      pricing: {
        ...model.pricing,
        units: model.pricing.units.map((unit) =>
          unit.strategy === 'fixed' ? { ...unit, rate: unit.rate * 2 } : unit,
        ),
      },
    };
  });
};

const loadLobeHubModels = async (): Promise<AiFullModelCard[]> =>
  (await loadLobeHubModelConfig()).models;

export const loadLobeHubPlanCardModels = async (): Promise<string[]> =>
  (await loadLobeHubModelConfig()).planCardModels;

export const isLobeHubModelAvailable = (
  _id: string,
  _expectedType: AiModelType,
  _options?: {
    getUserEmail?: () => Promise<string | null | undefined>;
    userEmail?: string | null;
  },
): boolean => false;
