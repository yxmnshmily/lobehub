import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';
import { formatIntergerNumber } from '@/utils/format';
import { lastMonth } from '@/utils/time';

import OverviewMetricCard from './OverviewMetricCard';
import TotalCard from './ShareButton/TotalCard';

const TotalMessages = memo<{ inShare?: boolean; mobile?: boolean }>(({ inShare, mobile }) => {
  const { t } = useTranslation('auth');
  const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.agents(), async () => ({
    count: await agentService.countAgents(),
    prevCount: await agentService.countAgents({ endDate: lastMonth().format('YYYY-MM-DD') }),
  }));

  if (inShare)
    return (
      <TotalCard
        count={formatIntergerNumber(data?.prevCount) || '--'}
        title={t('stats.assistants')}
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
        title={t('stats.assistants')}
        value={data?.count || '--'}
      />
    </AsyncBoundary>
  );
});

export default TotalMessages;
