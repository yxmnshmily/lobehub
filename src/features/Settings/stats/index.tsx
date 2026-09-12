'use client';

import { Flexbox, FormGroup, Grid, Icon } from '@lobehub/ui';
import { Tabs, Text } from '@lobehub/ui/base-ui';
import { ProviderIcon } from '@lobehub/ui/icons';
import { type DatePickerProps } from 'antd';
import { DatePicker, Divider } from 'antd';
import { createStaticStyles, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import { Brain, UserIcon } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useClientDataSWR } from '@/libs/swr';
import { statsKeys } from '@/libs/swr/keys';
import { usageService } from '@/services/usage';

import {
  ShareButton,
  TotalAssistants,
  TotalMessages,
  TotalTokens,
  TotalTopics,
  Welcome,
} from './features/overview';
import { AssistantsRank, ModelsRank, TopicsRank } from './features/rankings';
import { UsageCards, UsageTable, UsageTrends } from './features/usage';
import { AiHeatmaps } from './features/visualization';
import { GroupBy, type UserDisplayResolver } from './types';

const styles = createStaticStyles(({ css }) => ({
  mobile: css`
    button,
    input:not([type='hidden']) {
      min-height: 44px;
    }
  `,
  mobileUsageGroup: css`
    & > div:first-child {
      flex-direction: column !important;
      gap: 12px;
      align-items: stretch !important;
    }

    & > div:first-child > div {
      width: 100%;
    }
  `,
  statsUsageGroup: css`
    & .ant-collapse .ant-collapse-header,
    span.ant-collapse .ant-collapse-header {
      align-items: center !important;
    }
  `,
}));

interface StatsSettingProps {
  /**
   * Enable the "By User" group-by dimension in the Usage section. Only
   * meaningful when multiple users contribute to the data (i.e. workspace
   * mode). Combine with `resolveUser` to render names instead of opaque IDs.
   */
  enableUserDimension?: boolean;
  /**
   * Replace the personal Welcome banner (uses user nickname / registration
   * date) with a custom node. Pass `false` to drop the banner entirely.
   * When set (non-undefined), the personal ShareButton is also hidden because
   * the share link embeds user-identity context.
   */
  headerNode?: ReactNode | false;
  mobile?: boolean;
  /** Resolve userId → display info. Required when `enableUserDimension` is true. */
  resolveUser?: UserDisplayResolver;
  /** Render the standard personal-settings title and divider. */
  showSettingHeader?: boolean;
}

const StatsSetting = memo<StatsSettingProps>(
  ({
    mobile: mobileProp,
    headerNode,
    enableUserDimension,
    resolveUser,
    showSettingHeader = true,
  }) => {
    const { mobile: responsiveMobile = false } = useResponsive();
    const mobile = mobileProp ?? responsiveMobile;
    const { t, i18n } = useTranslation('auth');
    const { notice } = useMonthlyExchangeRate();
    dayjs.locale(i18n.language);

    const [groupBy, setGroupBy] = useState<GroupBy>(GroupBy.Model);
    const [dateRange, setDateRange] = useState<dayjs.Dayjs>(() => dayjs(new Date()));
    const [dateStrings, setDateStrings] = useState<string>();

    const { data, isLoading, error, mutate } = useClientDataSWR(statsKeys.usageStat(), async () =>
      usageService.findAndGroupByDay(dateStrings),
    );

    useEffect(() => {
      if (dateStrings) {
        mutate();
      }
    }, [dateStrings, mutate]);

    const handleDateChange: DatePickerProps['onChange'] = (dates, dateStrings) => {
      // Handle both single date and array
      const actualDate = Array.isArray(dates) ? dates[0] : dates;
      if (actualDate) {
        setDateRange(actualDate);
      }
      if (typeof dateStrings === 'string') {
        setDateStrings(dateStrings);
      }
    };

    const usageFilters = (
      <Flexbox
        horizontal
        align={'center'}
        gap={8}
        justify={'space-between'}
        style={{ alignSelf: 'center', flex: 1, minWidth: 0 }}
      >
        <Tabs
          activeKey={groupBy}
          style={{ maxWidth: '100%' }}
          items={[
            {
              icon: <Icon icon={Brain} />,
              key: GroupBy.Model,
              label: t('usage.welcome.model'),
            },
            {
              icon: <Icon icon={ProviderIcon} />,
              key: GroupBy.Provider,
              label: t('usage.welcome.provider'),
            },
            ...(enableUserDimension
              ? [
                  {
                    icon: <Icon icon={UserIcon} />,
                    key: GroupBy.User,
                    label: t('usage.welcome.user'),
                  },
                ]
              : []),
          ]}
          onChange={(key) => setGroupBy(key as GroupBy)}
        />
        <DatePicker picker="month" value={dateRange} onChange={handleDateChange} />
      </Flexbox>
    );

    return (
      <div className={mobile ? styles.mobile : undefined}>
        {showSettingHeader && <SettingHeader title={t('tab.stats')} />}
        {/* ========== Header Section ========== */}
        <FormGroup
          collapsible={false}
          extra={headerNode === undefined && !mobile ? <ShareButton mobile={mobile} /> : undefined}
          gap={16}
          variant={'filled'}
          title={
            headerNode === undefined ? (
              mobile ? (
                <div
                  data-testid="mobile-stats-welcome-header"
                  style={{
                    alignItems: 'start',
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'minmax(0, 1fr) 44px',
                    minWidth: 0,
                    width: '100%',
                  }}
                >
                  <Welcome mobile />
                  <ShareButton mobile />
                </div>
              ) : (
                <Welcome />
              )
            ) : headerNode === false ? undefined : (
              headerNode
            )
          }
        >
          <Flexbox data-testid="overview-sections" gap={mobile ? 16 : 24}>
            <div
              data-testid="overview-metrics"
              style={{
                alignItems: 'stretch',
                display: 'grid',
                gap: 8,
                gridTemplateColumns: mobile
                  ? 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(4, minmax(0, 1fr))',
                minWidth: 0,
              }}
            >
              <TotalAssistants mobile={mobile} />
              <TotalTopics mobile={mobile} />
              <TotalMessages mobile={mobile} />
              <TotalTokens mobile={mobile} />
            </div>
            <Divider dashed style={{ margin: 0 }} />
            <AiHeatmaps mobile={mobile} />
            <Divider dashed style={{ margin: 0 }} />
            <Grid gap={16} rows={3} style={{ paddingBottom: 12 }}>
              <ModelsRank />
              <AssistantsRank mobile={mobile} />
              <TopicsRank mobile={mobile} />
            </Grid>
          </Flexbox>
        </FormGroup>
        <FormGroup
          className={`${styles.statsUsageGroup}${mobile ? ` ${styles.mobileUsageGroup}` : ''}`}
          collapsible={false}
          extra={usageFilters}
          gap={16}
          title={t('tab.usage')}
          variant={'filled'}
          styles={{
            title: { lineHeight: '35px' },
          }}
        >
          <Flexbox data-testid="usage-sections" gap={mobile ? 16 : 24}>
            <Flexbox data-testid="usage-summary-sections" gap={mobile ? 16 : 24}>
              <AsyncBoundary
                data={data}
                error={error}
                errorVariant={'block'}
                onRetry={() => mutate()}
              >
                <UsageCards
                  data={data}
                  groupBy={groupBy}
                  isLoading={isLoading}
                  mobile={mobile}
                  resolveUser={resolveUser}
                />
                <Divider style={{ margin: 0 }} />
                <UsageTrends
                  data={data}
                  groupBy={groupBy}
                  isLoading={isLoading}
                  resolveUser={resolveUser}
                />
              </AsyncBoundary>
            </Flexbox>
            <div data-testid="usage-table-section">
              <UsageTable dateStrings={dateStrings} />
            </div>
            <Text fontSize={12} type="secondary">
              {notice}
            </Text>
          </Flexbox>
        </FormGroup>
      </div>
    );
  },
);

export default StatsSetting;
