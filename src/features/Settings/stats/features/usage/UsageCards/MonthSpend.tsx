'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';
import { type UsageLog } from '@/types/usage/usageRecord';
import { formatNumber } from '@/utils/format';

import { type UsageChartProps } from '../../../types';

const computeMonth = (
  data: UsageLog[],
): {
  calls: number | string;
  spend: number;
} => {
  if (!data || data?.length === 0) return { calls: 0, spend: 0 };

  const spend = data.reduce((acc, log) => acc + (log.totalSpend || 0), 0);
  const calls = data.reduce((acc, log) => acc + (log.records?.length ?? 0), 0);

  return {
    calls: formatNumber(calls),
    spend,
  };
};

const MonthSpend = memo<UsageChartProps>(({ data, isLoading, mobile }) => {
  const { t } = useTranslation('auth');
  const { symbol, convert } = useMonthlyExchangeRate();

  const { spend, calls } = computeMonth(data || []);

  return (
    <StatisticCard
      loading={isLoading}
      padding={mobile ? 12 : undefined}
      title={<TitleWithPercentage title={t('usage.cards.month.title')} />}
      statistic={{
        description: <Statistic title={t('usage.cards.month.modelCalls')} value={calls} />,
        precision: 2,
        prefix: symbol,
        value: Number.isFinite(convert(spend)) ? convert(spend) : '—',
        valueStyle: mobile
          ? { fontSize: 20, lineHeight: 1.2, whiteSpace: 'nowrap' }
          : undefined,
      }}
    />
  );
});

export default MonthSpend;
