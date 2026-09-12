'use client';

import { ModelIcon } from '@lobehub/icons';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowDownToLine, ArrowUpFromLine, Cpu, Database } from 'lucide-react';
import type { PricingUnit } from 'model-bank';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonText from '@/components/Skeleton/Text';
import { useBusinessModelPricing } from '@/business/client/hooks/useBusinessModelPricing';
import TablePagination from '@/components/TablePagination';
import { useAiInfraStore } from '@/store/aiInfra';
import { displayMoney } from '@/utils/currencyDisplay';
import { useTravelTranslation } from '@/utils/i18n/travel';

import { useMonthlyExchangeRate } from './useMonthlyExchangeRate';

export const formatModelRate = (
  unit: PricingUnit | undefined,
  currency: string,
  rate: number,
  language: string,
): string | null => {
  if (!unit || !['USD', 'CNY'].includes(currency)) return null;
  const prices =
    unit.strategy === 'fixed'
      ? [unit.rate]
      : unit.strategy === 'tiered'
        ? unit.tiers.map((tier) => tier.rate)
        : Object.values(unit.lookup.prices);
  if (!prices.length || prices.some((price) => !Number.isFinite(price) || price < 0)) return null;
  const format = (price: number) => displayMoney(price, currency, language, rate, 6);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? format(low) : `${format(low)} – ${format(high)}`;
};

const unitLabels: Record<PricingUnit['unit'], string> = {
  millionTokens: '/ 百万 Token',
  millionCharacters: '/ 百万字符',
  image: '/ 张',
  video: '/ 条视频',
  megapixel: '/ 百万像素',
  second: '/ 秒',
};
const styles = createStaticStyles(({ css }) => ({
  iconLabel: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
    svg {
      flex-shrink: 0;
    }
  `,
  pagination: css`
    && {
      border-block-start: 0;
    }
  `,
  rate: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: baseline;

    > * {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    @container model-pricing (max-width: 1000px) {
      flex-direction: column;
      gap: 2px;
      align-items: flex-start;
    }
  `,
  model: css`
    display: flex;
    gap: 10px;
    align-items: flex-start;

    > :first-child {
      flex-shrink: 0;
      margin-block-start: 2px;
    }

    > :last-child {
      min-width: 0;
    }
  `,
  section: css`
    container: model-pricing / inline-size;
    min-width: 0;
    margin-block-start: 32px;

    h2 {
      margin-block: 0 12px;
      margin-inline: 0;
      font-size: 20px;
    }

    p {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  table: css`
    overflow-x: auto;

    width: 100%;
    max-width: 100%;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    table {
      table-layout: fixed;
      border-collapse: collapse;
      width: 100%;
      font-variant-numeric: tabular-nums;

      @media (max-width: 575.98px) {
        min-width: 720px;
      }
    }

    th,
    td {
      padding-block: 16px;
      padding-inline: 12px;
      border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};

      text-align: start;
      white-space: normal;
      overflow-wrap: anywhere;
      vertical-align: top;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;
      background: ${cssVar.colorBgContainer};
    }

    th:first-child,
    td:first-child {
      width: 24%;
    }

    th:nth-child(2),
    td:nth-child(2),
    th:nth-child(3),
    td:nth-child(3) {
      width: 22%;
    }

    tbody tr:last-child td {
      border-block-end: 0;
    }

    small {
      display: block;
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
    }

    td > div + div {
      margin-block-start: 8px;
    }
  `,
}));

export default function EnabledModelPricing() {
  const [currentPage, setCurrentPage] = useState(1);
  const translate = useTravelTranslation();
  const { t } = useTranslation('components');
  const { quote, isCny, notice } = useMonthlyExchangeRate();
  const useFetchRuntime = useAiInfraStore((s) => s.useFetchAiProviderRuntimeState);
  const query = useFetchRuntime(true);
  const applyPricing = useBusinessModelPricing();
  const groups = [
    query.data?.enabledChatModelList,
    query.data?.enabledEmbeddingModelList,
    query.data?.enabledImageModelList,
    query.data?.enabledVideoModelList,
  ].flatMap((list) => list ?? []);
  const entries = [
    ...new Map(
      groups.flatMap((provider) =>
        provider.children.map(
          (model) => [`${provider.id}/${model.id}`, { provider, model }] as const,
        ),
      ),
    ).values(),
  ];
  const byModel = new Map<string, typeof entries>();
  for (const entry of entries) {
    const existing = byModel.get(entry.model.id);
    if (existing) existing.push(entry);
    else byModel.set(entry.model.id, [entry]);
  }
  const rows = [...byModel.values()];
  const page = Math.min(currentPage, Math.max(1, Math.ceil(rows.length / 20)));
  const pageRows = rows.slice((page - 1) * 20, page * 20);
  const priceCell = (units: PricingUnit[], currency: string, showName = false) =>
    units.length
      ? units.map((unit, index) => {
          const price = formatModelRate(unit, currency, quote.rate, isCny ? 'zh-CN' : 'en-US');
          return (
            <div className={styles.rate} key={`${unit.name}-${index}`}>
              {showName && <small>{t(`ModelSwitchPanel.detail.pricing.unit.${unit.name}`)}</small>}
              <span>{price ?? translate('未配置价格')}</span>
              {price && <small>{translate(unitLabels[unit.unit])}</small>}
            </div>
          );
        })
      : '—';

  return (
    <section aria-label={translate('已启用模型价格')} className={styles.section}>
      <h2>{translate('已启用模型价格')}</h2>
      <p>
        {translate(
          '仅展示当前已启用模型的配置报价；区间价格随上下文或生成参数变化，实际消费以积分流水为准。',
        )}
      </p>
      <p>{notice}</p>
      <p>
        {translate(
          '部分缺省报价采用公开的北京地域参考价；实际费用可能因地区、缓存和服务商配置而不同。',
        )}
      </p>
      <p>{translate('— 表示未提供该计费项，不代表免费。')}</p>
      {entries.some(({ provider }) => provider.id === 'deepseek') && (
        <p>
          {isCny
            ? 'DeepSeek 官方参考价（2026-09-06 核对）：区间下限为空闲价，上限为高峰价。高峰为北京时间周一至周五 09:00–12:00、14:00–18:00，其余为空闲时段；自定义报价除外。'
            : 'DeepSeek official reference prices (checked 2026-09-06): ranges show off-peak to peak rates. Peak hours: Monday–Friday 09:00–12:00 and 14:00–18:00, Beijing time; all other hours are off-peak. Custom prices are excluded.'}{' '}
          <a
            href="https://api-docs.deepseek.com/zh-cn/quick_start/pricing/"
            rel="noreferrer"
            target="_blank"
          >
            {isCny ? '官方价格说明' : 'Official pricing'}
          </a>
        </p>
      )}
      {query.error ? (
        <Alert
          action={<Button onClick={() => void query.mutate()}>{translate('重试')}</Button>}
          title={translate('模型价格暂时无法读取')}
          type="error"
        />
      ) : query.isLoading || !query.data ? (
        <SkeletonText rows={3} />
      ) : !rows.length ? (
        <p>{translate('暂无已启用模型')}</p>
      ) : (
        <>
          <div
            aria-label={translate('模型价格表')}
            className={styles.table}
            role="region"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {[
                    { label: '模型', icon: Cpu },
                    { label: '输入', icon: ArrowDownToLine },
                    { label: '输出', icon: ArrowUpFromLine },
                    { label: '缓存与其他计费', icon: Database },
                  ].map(({ label, icon: HeaderIcon }) => (
                    <th key={label} scope="col">
                      <span className={styles.iconLabel}>
                        <HeaderIcon aria-hidden size={16} />
                        {translate(label)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((variants) => {
                  const { model } = variants[0];
                  const quotes = variants.map(({ model, provider }) => ({
                    provider,
                    reference: !model.pricing,
                    pricing: applyPricing({
                      model: model.id,
                      provider: provider.id,
                      pricing: model.pricing,
                    }),
                  }));
                  const configured = quotes.filter(({ pricing }) => pricing?.units.length);
                  const offers = [
                    ...new Map(
                      (configured.length ? configured : quotes.slice(0, 1)).map((quote) => [
                        JSON.stringify(quote.pricing),
                        quote,
                      ]),
                    ).values(),
                  ];
                  const renderPrices = (kind: 'input' | 'output' | 'other') =>
                    offers.map(({ provider, pricing }, index) => (
                      <div key={index}>
                        {offers.length > 1 && <small>{provider.name || provider.id}</small>}
                        {priceCell(
                          (pricing?.units ?? []).filter((unit) =>
                            kind === 'input'
                              ? unit.name === 'textInput'
                              : kind === 'output'
                                ? unit.name === 'textOutput'
                                : unit.name !== 'textInput' && unit.name !== 'textOutput',
                          ),
                          pricing?.currency ?? 'USD',
                          kind === 'other',
                        )}
                      </div>
                    ));
                  return (
                    <tr key={model.id}>
                      <td>
                        <div className={styles.model}>
                          <ModelIcon model={model.id} size={24} />
                          <div>
                            <span>{model.displayName || model.id}</span>
                            <small>
                              {variants
                                .map(({ provider }) => provider.name || provider.id)
                                .join(' / ')}{' '}
                              · {model.id}
                            </small>
                            {!configured.length && <small>{translate('未配置价格')}</small>}
                            {configured.length > 0 &&
                              configured.every(({ reference }) => reference) && (
                                <small>{translate('公开参考价')}</small>
                              )}
                          </div>
                        </div>
                      </td>
                      <td>{renderPrices('input')}</td>
                      <td>{renderPrices('output')}</td>
                      <td>{renderPrices('other')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            className={styles.pagination}
            current={page}
            pageSize={20}
            pageSizeOptions={[20]}
            total={rows.length}
            onChange={setCurrentPage}
          />
        </>
      )}
    </section>
  );
}
