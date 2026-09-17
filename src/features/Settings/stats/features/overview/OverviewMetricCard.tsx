import { Tag } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo, type ReactNode } from 'react';

import StatisticCard, { type StatisticConfig } from '@/components/StatisticCard';
import { calcGrowthPercentage } from '@/components/StatisticCard/growthPercentage';
import TitleWithPercentage from '@/components/StatisticCard/TitleWithPercentage';

interface OverviewMetricCardProps {
  count?: number;
  inverseColor?: boolean;
  loading?: boolean;
  mobile?: boolean;
  precision?: number;
  prevCount?: number;
  previousTitle: string;
  previousValue: ReactNode;
  title: string;
  value: number | string;
  valueStyle?: StatisticConfig['valueStyle'];
}

const OverviewMetricCard = memo<OverviewMetricCardProps>(
  ({
    count,
    inverseColor,
    loading,
    mobile,
    precision,
    prevCount,
    previousTitle,
    previousValue,
    title,
    value,
    valueStyle,
  }) => {
    const percentage = calcGrowthPercentage(count || 0, prevCount || 0);
    const showPercentage = !!count && !!prevCount && percentage !== 0;
    const growthColor = inverseColor
      ? percentage > 0
        ? cssVar.colorWarning
        : cssVar.colorSuccess
      : percentage > 0
        ? cssVar.colorSuccess
        : cssVar.colorWarning;

    return (
      <StatisticCard
        loading={loading}
        padding={mobile ? 12 : undefined}
        statistic={{
          description: (
            <div
              style={{
                alignItems: 'baseline',
                color: cssVar.colorTextDescription,
                display: 'flex',
                flexWrap: 'wrap',
                fontSize: 12,
                gap: 4,
                minWidth: 0,
              }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>{previousTitle}</span>
              <strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {previousValue}
              </strong>
            </div>
          ),
          precision,
          style: mobile ? { gap: 8, minWidth: 0 } : undefined,
          value,
          valueStyle: mobile
            ? {
                fontSize: 20,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                ...valueStyle,
              }
            : valueStyle,
        }}
        title={
          mobile ? (
            <div
              style={{
                alignItems: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
              }}
            >
              <h2
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  lineHeight: '20px',
                  margin: 0,
                  maxWidth: '100%',
                  whiteSpace: 'nowrap',
                }}
              >
                {title}
              </h2>
              {showPercentage ? (
                <Tag
                  variant={'borderless'}
                  style={{
                    color: growthColor,
                    flex: 'none',
                    fontVariantNumeric: 'tabular-nums',
                    margin: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {percentage > 0 ? '+' : ''}
                  {percentage.toFixed(1)}%
                </Tag>
              ) : null}
            </div>
          ) : (
            <TitleWithPercentage
              count={count}
              inverseColor={inverseColor}
              prvCount={prevCount}
              title={title}
            />
          )
        }
      />
    );
  },
);

OverviewMetricCard.displayName = 'OverviewMetricCard';

export default OverviewMetricCard;
