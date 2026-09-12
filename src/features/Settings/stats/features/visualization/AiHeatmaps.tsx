import { type HeatmapsProps } from '@lobehub/charts';
import { Heatmaps } from '@lobehub/charts';
import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs, Tag } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CoinsIcon, FlameIcon, MessageSquareIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { formatIntergerNumber, formatLocalizedTokens as formatShortenNumber } from '@/utils/format';

import { HeatmapType } from '../../types';
import StatsFormGroup from '../components/StatsFormGroup';
import HeatmapStats from './HeatmapStats';

const styles = createStaticStyles(({ css }) => ({
  /* 热力图月份标签行：上下各留 16px（原来贴得太紧） */
  monthLabels: css`
    g.legend-month {
      padding-block: 16px;
    }
  `,
  fullWidth: css`
    align-self: stretch;
    width: 100%;
    min-width: 0;

    & > div > svg {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
  mobileScroller: css`
    scrollbar-width: none;

    overflow-x: auto;
    overscroll-behavior-inline: contain;

    max-width: 100%;

    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }
  `,
}));

const getShareMonthLabels = (startDate?: string) => {
  const parsedStartMonth = Number(startDate?.slice(5, 7)) - 1;
  const startMonth =
    Number.isInteger(parsedStartMonth) && parsedStartMonth >= 0 && parsedStartMonth < 12
      ? parsedStartMonth
      : 0;

  return Array.from({ length: 12 }, (_, index) => `${((startMonth + index) % 12) + 1}月`);
};

const AiHeatmaps = memo<
  Omit<HeatmapsProps, 'data' | 'ref'> & { inShare?: boolean; mobile?: boolean }
>(({ inShare, mobile, ...rest }) => {
  const { t, i18n } = useTranslation('auth');
  const [type, setType] = useState<HeatmapType>(
    inShare ? HeatmapType.Messages : HeatmapType.Tokens,
  );
  const isTokens = type === HeatmapType.Tokens;

  const { data, error, isLoading, mutate } = useClientDataSWR(statsKeys.heatmaps(type), async () =>
    isTokens ? messageService.getTokenHeatmaps() : messageService.getHeatmaps(),
  );

  const days = data?.filter((item) => item.level > 0).length || '--';
  const hotDays = data?.filter((item) => item.level >= 3).length || '--';
  const shareMonthLabels = getShareMonthLabels(data?.[0]?.date);

  const heatmap = (
    <Heatmaps
      blockMargin={mobile ? 3 : undefined}
      blockRadius={mobile ? 2 : undefined}
      blockSize={mobile ? 6 : 14}
      className={!mobile && !inShare ? `${styles.fullWidth} ${styles.monthLabels}` : undefined}
      data={data || []}
      hideMonthLabels={inShare}
      hideTotalCount={isTokens}
      loading={isLoading || !data}
      maxLevel={4}
      customTooltip={(activity) =>
        t(isTokens ? 'heatmaps.tooltipTokens' : 'heatmaps.tooltip', {
          count: isTokens
            ? formatShortenNumber(activity.count, i18n.language)
            : formatIntergerNumber(activity.count),
          date: activity.date,
        })
      }
      labels={{
        legend: {
          less: t('heatmaps.legend.less'),
          more: t('heatmaps.legend.more'),
        },
        months: [
          t('heatmaps.months.jan'),
          t('heatmaps.months.feb'),
          t('heatmaps.months.mar'),
          t('heatmaps.months.apr'),
          t('heatmaps.months.may'),
          t('heatmaps.months.jun'),
          t('heatmaps.months.jul'),
          t('heatmaps.months.aug'),
          t('heatmaps.months.sep'),
          t('heatmaps.months.oct'),
          t('heatmaps.months.nov'),
          t('heatmaps.months.dec'),
        ],
        tooltip: isTokens ? t('heatmaps.tooltipTokens') : t('heatmaps.tooltip'),
        totalCount: isTokens ? t('heatmaps.totalCountTokens') : t('heatmaps.totalCount'),
      }}
      style={{
        alignSelf: !mobile && !inShare ? 'stretch' : 'center',
        // Give the month labels breathing room above the calendar grid
        gap: mobile ? 12 : 24,
      }}
      {...rest}
    />
  );

  const content = (
    <AsyncBoundary
      data={data}
      error={error}
      isLoading={isLoading}
      loading={heatmap}
      onRetry={() => mutate()}
    >
      {heatmap}
    </AsyncBoundary>
  );

  const typeSwitch = (
    <Tabs
      activeKey={type}
      size={'small'}
      style={{ width: 'auto' }}
      items={[
        {
          icon: <Icon icon={CoinsIcon} />,
          key: HeatmapType.Tokens,
          label: t('stats.tokens'),
        },
        {
          icon: <Icon icon={MessageSquareIcon} />,
          key: HeatmapType.Messages,
          label: t('stats.messages'),
        },
      ]}
      onChange={(key) => setType(key as HeatmapType)}
    />
  );

  const dayTags = (
    <Flexbox horizontal gap={8}>
      <Tag variant={'filled'}>{[days, t('stats.days')].join(' ')}</Tag>
      <Tag color={'success'} icon={<Icon icon={FlameIcon} />} variant={'filled'}>
        {[hotDays, t('stats.days')].join(' ')}
      </Tag>
    </Flexbox>
  );

  if (inShare) {
    return (
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={4} justify={'space-between'}>
          <div
            style={{
              color: cssVar.colorTextDescription,
              fontSize: 12,
            }}
          >
            {t('stats.lastYearActivity')}
          </div>
          {dayTags}
        </Flexbox>
        <div
          style={{
            color: cssVar.colorTextDescription,
            display: 'grid',
            fontSize: 10,
            gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
            lineHeight: '16px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            width: '100%',
          }}
        >
          {shareMonthLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        {content}
      </Flexbox>
    );
  }

  return (
    <StatsFormGroup
      afterTitle={typeSwitch}
      extra={dayTags}
      fontSize={16}
      title={t('stats.lastYearActivity')}
    >
      <HeatmapStats />
      {mobile ? (
        <div
          className={styles.mobileScroller}
          style={{
            maxWidth: '100%',
            overflowX: 'auto',
            overscrollBehaviorInline: 'contain',
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {content}
        </div>
      ) : (
        content
      )}
    </StatsFormGroup>
  );
});

export default AiHeatmaps;
