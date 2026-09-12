'use client';

import dayjs from 'dayjs';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Statistic from '@/components/Statistic';
import StatisticCard from '@/components/StatisticCard';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';
import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';
import { type UsageLog } from '@/types/usage/usageRecord';

import { type UsageChartProps } from '../../../types';

const computeSpend = (
  data: UsageLog[],
): {
  today: number;
  yesterday: number;
} => {
  if (!data || data?.length === 0) return { today: 0, yesterday: 0 };

  const today = data.find((log) => dayjs.utc(log.day).isToday())?.totalSpend ?? 0;
  const yesterday = data.find((log) => dayjs.utc(log.day).isYesterday())?.totalSpend ?? 0;

  return {
    today,
    yesterday,
  };
};

const TodaySpend = memo<UsageChartProps>(({ data, isLoading, mobile }) => {
  const { t } = useTranslation('auth');
  const { symbol, convert, format } = useMonthlyExchangeRate();

  const { today, yesterday } = computeSpend(data || []);

  return (
    <StatisticCard
      loading={isLoading}
      padding={mobile ? 12 : undefined}
      statistic={{
        description: (
          <Statistic title={t('usage.cards.today.yesterday')} value={format(yesterday)} />
        ),
        precision: 2,
        prefix: symbol,
        value: Number.isFinite(convert(today)) ? convert(today) : '—',
        valueStyle: mobile
          ? { fontSize: 20, lineHeight: 1.2, whiteSpace: 'nowrap' }
          : undefined,
      }}
      title={
        <TitleWithPercentage
          count={typeof today === 'number' ? today : 0}
          prvCount={typeof yesterday === 'number' ? yesterday : 0}
          title={t('usage.cards.today.title')}
        />
      }
    />
  );
});

export default TodaySpend;
