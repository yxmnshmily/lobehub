import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonBar from '@/components/Skeleton/Bar';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { formatLocalizedTokens as formatShortenNumber } from '@/utils/format';

import { HeatmapType } from '../../types';

const styles = createStaticStyles(({ css }) => ({
  summary: css`
    /* Physical side retained for the page style editor. */
    /* stylelint-disable-next-line liberty/use-logical-spec */
    margin-bottom: 24px;
  `,
}));

/**
 * Render a wall-clock duration in seconds as a compact "1h 15m" / "15m 20s" /
 * "45s" string. Returns '--' when there is nothing to show.
 */
const formatDuration = (seconds?: number) => {
  if (!seconds || seconds < 1) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

/**
 * Token-dimension summary row for the activity heatmap. The peak / streak figures
 * are derived from the daily token-heatmap series (same SWR key as the heatmap,
 * so the request is deduped); the longest-task duration comes from the agent
 * operations' wall-clock time. The cumulative token total lives in the overview
 * cards above, so it is intentionally not repeated here.
 */
const HeatmapStats = memo(() => {
  const { t, i18n } = useTranslation('auth');

  const { data, isLoading } = useClientDataSWR(statsKeys.heatmaps(HeatmapType.Tokens), () =>
    messageService.getTokenHeatmaps(),
  );
  const loading = isLoading || !data;

  const { data: maxTaskDuration } = useClientDataSWR(statsKeys.maxTaskDuration(), () =>
    topicService.getMaxTaskDuration(),
  );

  const stats = useMemo(() => {
    if (!data?.length) return { current: 0, longest: 0, peak: 0 };

    let peak = 0;
    let longest = 0;
    let run = 0;
    for (const item of data) {
      if (item.count > peak) peak = item.count;
      if (item.count > 0) {
        run += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }

    // Current streak: trailing consecutive active days. The last bucket (today)
    // may legitimately be 0 because the day isn't over, so it doesn't break it.
    let current = 0;
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if (data[i].count > 0) current += 1;
      else if (i === data.length - 1) continue;
      else break;
    }

    return { current, longest, peak };
  }, [data]);

  const days = (n: number) => [n, t('stats.days')].join(' ');

  const items = [
    {
      label: t('stats.heatmapStats.peakTokens'),
      value: formatShortenNumber(stats.peak, i18n.language),
    },
    {
      label: t('stats.heatmapStats.longestTask'),
      loading: maxTaskDuration === undefined,
      value: formatDuration(maxTaskDuration),
    },
    { label: t('stats.heatmapStats.currentStreak'), value: days(stats.current) },
    { label: t('stats.heatmapStats.longestStreak'), value: days(stats.longest) },
  ];

  return (
    <Block
      className={styles.summary}
      data-testid="heatmap-summary"
      paddingBlock={16}
      paddingInline={8}
      variant={'outlined'}
    >
      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          width: '100%',
        }}
      >
        {items.map((item) => (
          <Flexbox
            align={'center'}
            gap={4}
            key={item.label}
            style={{ minWidth: 0, paddingBlock: 6, paddingInline: 4, textAlign: 'center' }}
          >
            <div style={{ fontSize: 20, fontWeight: 'bold' }}>
              {loading || item.loading ? <SkeletonBar height={28} width={56} /> : item.value}
            </div>
            <div
              style={{
                color: cssVar.colorTextDescription,
                fontSize: 12,
                lineHeight: 1.4,
                overflowWrap: 'anywhere',
              }}
            >
              {item.label}
            </div>
          </Flexbox>
        ))}
      </div>
    </Block>
  );
});

export default HeatmapStats;
