import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { type UsageChartProps } from '../../../types';
import ActiveModels from './ActiveModels';
import MonthSpend from './MonthSpend';
import TodaySpend from './TodaySpend';

const UsageCards = memo<UsageChartProps>(({ isLoading, data, groupBy, mobile, resolveUser }) => {
  if (mobile) {
    return (
      <div
        data-testid="mobile-usage-cards"
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          minWidth: 0,
          width: '100%',
        }}
      >
        <TodaySpend mobile data={data} isLoading={isLoading} />
        <MonthSpend mobile data={data} isLoading={isLoading} />
        <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
          <ActiveModels
            mobile
            data={data}
            groupBy={groupBy}
            isLoading={isLoading}
            resolveUser={resolveUser}
          />
        </div>
      </div>
    );
  }

  return (
    <Flexbox horizontal gap={16}>
      <TodaySpend data={data} isLoading={isLoading} />
      <MonthSpend data={data} isLoading={isLoading} />
      <ActiveModels data={data} groupBy={groupBy} isLoading={isLoading} resolveUser={resolveUser} />
    </Flexbox>
  );
});

export default UsageCards;
