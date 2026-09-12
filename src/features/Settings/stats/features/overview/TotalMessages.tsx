import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { formatIntergerNumber } from '@/utils/format';
import { lastMonth } from '@/utils/time';

import OverviewMetricCard from './OverviewMetricCard';
import TotalCard from './ShareButton/TotalCard';

const TotalMessages = memo<{ inShare?: boolean; mobile?: boolean }>(({ inShare, mobile }) => {
  const { t } = useTranslation('auth');
  const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.messages(), async () => {
    // The total is a planner estimate, but the last-month baseline is derived
    // from it with an exact count of this month's messages (cheap — date-
    // bounded) rather than a second estimate: without multicolumn statistics
    // the planner can badly misjudge a user×date predicate, which would turn
    // the growth percentage next to the number into noise.
    const count = await messageService.countMessages({ approximate: true });
    const sinceLastMonth = await messageService.countMessages({
      startDate: lastMonth().add(1, 'day').format('YYYY-MM-DD'),
    });

    return { count, prevCount: Math.max(count - sinceLastMonth, 0) };
  });

  if (inShare)
    return (
      <TotalCard
        count={formatIntergerNumber(data?.prevCount) || '--'}
        title={t('stats.messages')}
      />
    );

  return (
    <AsyncBoundary data={data} error={error} errorVariant={'metric'} onRetry={() => mutate()}>
      <OverviewMetricCard
        count={data?.count}
        loading={isLoading || !data}
        mobile={mobile}
        precision={0}
        prevCount={data?.prevCount}
        previousTitle={t('date.prevMonth')}
        previousValue={formatIntergerNumber(data?.prevCount) || '--'}
        title={t('stats.messages')}
        value={data?.count || '--'}
      />
    </AsyncBoundary>
  );
});

export default TotalMessages;
