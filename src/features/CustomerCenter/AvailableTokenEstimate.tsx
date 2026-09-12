'use client';

import { formatLocalizedTokens } from '@lobechat/utils/format';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import type { Pricing } from 'model-bank';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import { useAiInfraStore } from '@/store/aiInfra';

import { estimateCreditTokens } from './estimateCreditTokens';
import { useMonthlyExchangeRate } from './useMonthlyExchangeRate';

const styles = createStaticStyles(({ css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-block-start: 12px;
    min-width: 0;
    font-variant-numeric: tabular-nums;
    label {
      display: flex;
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      align-items: center;
      gap: 8px;
    }
    select {
      min-width: 0;
      width: 100%;
      max-width: 100%;
      padding: 8px;
      padding-inline-end: 36px;
      appearance: none;
      border: 0.5px solid ${cssVar.colorBorder};
      border-radius: 8px;
      color: ${cssVar.colorText};
      background: ${cssVar.colorBgContainer};
      font: inherit;
    }
    small {
      color: ${cssVar.colorTextSecondary};
      line-height: 1.6;
    }
  `,
  selectors: css`
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;

    label:last-child {
      flex: 1.5;
    }
  `,
  selectControl: css`
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;

    svg {
      pointer-events: none;
      position: absolute;
      inset-inline-end: 10px;
      top: 50%;
      transform: translateY(-50%);
    }
  `,
}));

export default function AvailableTokenEstimate({
  children,
  credits,
  preferredModel,
}: {
  children?: (estimate: ReactNode, pricing: Pricing | undefined) => ReactNode;
  credits?: number | null;
  preferredModel?: string | null;
}) {
  const { i18n } = useTranslation();
  const { quote, stale, notice } = useMonthlyExchangeRate();
  const language = i18n.language || 'en-US';
  const zh = /^zh(?:-|$)/i.test(language);
  const [selected, setSelected] = useState('');
  const query = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState)(true);
  const applyPricing = useBusinessModelPricing();
  const models = (query.data?.enabledChatModelList ?? []).flatMap((provider) =>
    provider.children.map((model) => ({
      key: `${provider.id}/${model.id}`,
      model,
      provider,
    })),
  );
  const choice =
    models.find((entry) => entry.key === selected) ??
    models.find((entry) => entry.provider.id === 'deepseek' && entry.model.id === preferredModel) ??
    models.find((entry) => entry.provider.id === 'deepseek') ??
    models.find((entry) => entry.model.id === preferredModel) ??
    models[0];
  const providers = [...new Map(models.map(({ provider }) => [provider.id, provider])).values()];
  const providerModels = models.filter((entry) => entry.provider.id === choice?.provider.id);
  const uniqueModels = [...new Map(providerModels.map(({ model }) => [model.id, model])).values()];
  const pricing =
    choice &&
    applyPricing({
      model: choice.model.id,
      provider: choice.provider.id,
      pricing: choice.model.pricing,
    });
  const format = (name: 'textInput' | 'textOutput') => {
    const range = estimateCreditTokens(credits, pricing, name, stale ? undefined : quote.rate);
    if (!range) return '—';
    const low = formatLocalizedTokens(range[0], language);
    return range[0] === range[1] ? low : `${low}–${formatLocalizedTokens(range[1], language)}`;
  };
  const estimate = (
    <div className={styles.root}>
      {choice && !query.error ? (
        <>
          <div className={styles.selectors}>
            <label>
              {zh ? '服务商' : 'Provider'}
              <span className={styles.selectControl}>
                <select
                  value={choice.provider.id}
                  onChange={(event) => {
                    const candidates = models.filter(
                      (entry) => entry.provider.id === event.target.value,
                    );
                    const next =
                      candidates.find((entry) => entry.model.id === choice.model.id) ??
                      candidates[0];
                    if (next) setSelected(next.key);
                  }}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name || provider.id}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden size={16} />
              </span>
            </label>
            <label>
              {zh ? '估算模型' : 'Estimate model'}
              <span className={styles.selectControl}>
                <select
                  value={choice.model.id}
                  onChange={(event) => {
                    const next = providerModels.find(
                      (entry) => entry.model.id === event.target.value,
                    );
                    if (next) setSelected(next.key);
                  }}
                >
                  {uniqueModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName || model.id}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden size={16} />
              </span>
            </label>
          </div>
          <div aria-live="polite">
            <div>
              {zh ? '≈ 可用输入' : '≈ Available input'} {format('textInput')} Token
            </div>
            <div>
              {zh ? '或可用输出' : 'Or available output'} {format('textOutput')} Token
            </div>
          </div>
          <small>
            {zh
              ? '按所选模型配置/参考报价估算，分别假设余额全部用于输入或输出，不能相加；不含缓存优惠及其他费用。— 表示无法估算。实际扣费以积分流水为准。'
              : 'Estimates use the selected model’s configured/reference prices, assuming all credits go to input OR output, not both. Cache discounts and other charges are excluded. — means unavailable. Credit transactions remain authoritative.'}
          </small>
          {pricing?.currency === 'CNY' && <small>{notice}</small>}
        </>
      ) : (
        <small>
          {zh
            ? '模型报价暂不可用，无法估算 Token 数量。'
            : 'Model pricing unavailable; token capacity cannot be estimated.'}
        </small>
      )}
    </div>
  );
  return children ? children(estimate, query.error ? undefined : pricing) : estimate;
}
