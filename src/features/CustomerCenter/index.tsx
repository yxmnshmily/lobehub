'use client';

import { Block, Flexbox, FormGroup, Icon } from '@lobehub/ui';
import { Alert, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider, Empty } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronDownIcon, Clock3Icon, CoinsIcon, FileOutputIcon, SparklesIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Link, useSearchParams } from 'react-router';

import SkeletonText from '@/components/Skeleton/Text';
import ProfileSetting from '@/features/Settings/profile';
import { useTravelTranslation } from '@/utils/i18n/travel';

import CreditsOrders from './CreditsOrders';
import GroupInvitations from './GroupInvitations';
import LoginSessions from './LoginSessions';
import {
  type CustomerBalances,
  type CustomerCenterCopy,
  type CustomerCenterData,
  type CustomerCenterDataState,
  type CustomerCenterPagination,
  type CustomerCenterPaginationControl,
  type CustomerCenterSectionKey,
  type CustomerCreationStatus,
  type CustomerGenerationDetail,
  type CustomerGenerationFilters,
  type CustomerGenerationTask,
  type CustomerRechargeRecord,
  type CustomerServiceOrder,
  type CustomerWork,
  formatCredits,
  formatCustomerDateTime,
  formatSignedCredits,
  formatTokenCount,
  getCreationStatusKey,
  resolveCustomerCenterSection,
  resolveTotalTokenCount,
} from './model';
import { useMonthlyExchangeRate } from './useMonthlyExchangeRate';

export type {
  CustomerBalances,
  CustomerCenterCopy,
  CustomerCenterData,
  CustomerCenterDataState,
  CustomerCenterPagination,
  CustomerCenterPaginationControl,
  CustomerCenterSectionKey,
  CustomerCreations,
  CustomerGenerationArtifact,
  CustomerGenerationDetail,
  CustomerGenerationFilters,
  CustomerGenerationStatusFilter,
  CustomerGenerationTask,
  CustomerGenerationType,
  CustomerRechargeRecord,
  CustomerServiceOrder,
  CustomerUsageSummary,
  CustomerWork,
} from './model';

export interface CustomerCenterProps {
  copy: CustomerCenterCopy;
  data: CustomerCenterData;
  defaultSection?: CustomerCenterSectionKey;
  generationDetail?: CustomerCenterDataState<CustomerGenerationDetail>;
  generationFilters?: CustomerGenerationFilters;
  locale: string;
  onCloseGenerationDetail?: () => void;
  onGenerationFiltersChange?: (filters: CustomerGenerationFilters) => void;
  onOpenGenerationDetail?: (id: string) => void;
  onRefresh?: () => void;
  onRetryCreations?: () => void;
  onRetryGenerationDetail?: () => void;
  onRetryOrders?: () => void;
  onRetryOverview?: () => void;
  onRetryRecharges?: () => void;
  pagination?: CustomerCenterPagination;
}

const styles = createStaticStyles(({ css, responsive }) => ({
  creationGrid: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    min-width: 0;

    ${responsive.md} {
      grid-template-columns: 1fr;
    }
  `,
  creationList: css`
    min-width: 0;

    > * {
      min-width: 0;
    }
  `,
  creationListHeader: css`
    min-width: 0;

    > h2 {
      overflow: hidden;
      min-width: 0;
      font-size: ${cssVar.fontSizeLG};
      line-height: 24px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  filters: css`
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    min-width: 0;

    ${responsive.sm} {
      grid-template-columns: 1fr;
    }
  `,
  filterControl: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 36px;
    padding-inline: 10px;
    border: 0.5px solid ${cssVar.colorBorder};
    border-radius: 8px;

    color: ${cssVar.colorText};

    color-scheme: light;
    background: ${cssVar.colorBgContainer};

    html[data-theme='dark'] & {
      color-scheme: dark;
    }

    &[type='date'] {
      max-width: 100%;
    }
  `,
  filterSelect: css`
    cursor: pointer;
    appearance: none;
    padding-inline-end: 36px;
  `,
  filterSelectIcon: css`
    pointer-events: none;
    position: absolute;
    inset-block-start: 50%;
    inset-inline-end: 10px;
    transform: translateY(-50%);

    display: inline-flex;

    color: ${cssVar.colorTextSecondary};
  `,
  filterSelectWrap: css`
    position: relative;
    min-width: 0;
  `,
  itemTitle: css`
    overflow: hidden;
    display: block;
    min-width: 0;
    max-width: 100%;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  link: css`
    color: ${cssVar.colorLink};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorLinkHover};
      text-decoration: underline;
    }
  `,
  metricValue: css`
    font-variant-numeric: tabular-nums;
  `,
  page: css`
    width: 100%;
    max-width: 100%;
    margin-block: 0;
    margin-inline: auto;
    /* Gutter comes from the settings container (48px per side). */

    ${responsive.sm} {
      padding-block: 16px;
      padding-inline: var(--mobile-page-inner-gutter, var(--mobile-page-gutter, 10px));
    }
  `,
  row: css`
    min-width: 0;
    padding-block: 14px;
  `,
  rowHeading: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  `,
  rowMeta: css`
    min-width: 0;
    flex-wrap: wrap;

    > * {
      max-width: 100%;
    }
  `,
  usageMetrics: css`
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;

    ${responsive.sm} {
      justify-content: flex-start;
    }
  `,
}));

const DataBoundary = <T,>({
  children,
  emptyDescription,
  onRetry,
  state,
}: {
  children: (data: T) => ReactNode;
  emptyDescription: string;
  onRetry?: () => void;
  state: CustomerCenterDataState<T>;
}) => {
  const translateTravel = useTravelTranslation();
  if (state.isLoading)
    return (
      <Flexbox aria-label={translateTravel('加载中')} role="status">
        <SkeletonText animated aria-hidden rows={3} />
      </Flexbox>
    );
  if (state.error)
    return (
      <Alert
        showIcon
        action={onRetry ? <Button onClick={onRetry}>{translateTravel('重试')}</Button> : undefined}
        title={state.error}
        type="error"
      />
    );
  if (state.isUnavailable) return <Alert showIcon title={emptyDescription} type="warning" />;
  if (state.data === undefined)
    return <Empty description={emptyDescription} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return children(state.data);
};

const AccountSecurity = ({ copy, locale }: { copy: CustomerCenterCopy; locale: string }) => {
  return (
    <Flexbox gap={20}>
      <ProfileSetting showSettingHeader={false} />
      <GroupInvitations locale={locale} />
      <FormGroup collapsible={false} gap={16} title={copy.accountSecurityTitle} variant="filled">
        <Flexbox gap={24}>
          {copy.sessionSecurityNotice && (
            <Alert showIcon title={copy.sessionSecurityNotice} type="info" />
          )}
          <LoginSessions locale={locale} />
        </Flexbox>
      </FormGroup>
    </Flexbox>
  );
};

const Balances = ({
  copy,
  locale,
  onRetry,
  state,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  onRetry?: () => void;
  state: CustomerCenterDataState<CustomerBalances>;
}) => {
  return (
    <DataBoundary emptyDescription={copy.balanceUnavailable} state={state} onRetry={onRetry}>
      {(balances) => (
        <Block gap={8} padding={20} variant="outlined">
          <Flexbox horizontal align="center" gap={8}>
            <Icon color={cssVar.colorPrimary} icon={CoinsIcon} size={18} />
            <Text type="secondary">{copy.creditBalanceLabel}</Text>
          </Flexbox>
          <Text as="div" className={styles.metricValue} fontSize={28} weight={700}>
            {formatCredits(balances.creditBalance, locale)}
          </Text>
        </Block>
      )}
    </DataBoundary>
  );
};

const Usage = ({
  copy,
  locale,
  onRetry,
  state,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  onRetry?: () => void;
  state: CustomerCenterData['usage'];
}) => {
  return (
    <DataBoundary emptyDescription={copy.usageEmpty} state={state} onRetry={onRetry}>
      {(usage) => {
        const totalTokens = resolveTotalTokenCount(usage);
        if (
          usage.inputTokens === undefined &&
          usage.outputTokens === undefined &&
          totalTokens === undefined
        ) {
          return <Empty description={copy.usageEmpty} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
        }

        return (
          <Block padding={20} variant="outlined">
            <Flexbox horizontal className={styles.usageMetrics} gap={20}>
              <Text className={styles.metricValue} type="secondary">
                {copy.inputTokensLabel} {formatTokenCount(usage.inputTokens, locale)}
              </Text>
              <Text className={styles.metricValue} type="secondary">
                {copy.outputTokensLabel} {formatTokenCount(usage.outputTokens, locale)}
              </Text>
              <Text className={styles.metricValue} weight={600}>
                {copy.totalTokensLabel} {formatTokenCount(totalTokens, locale)}
              </Text>
            </Flexbox>
          </Block>
        );
      }}
    </DataBoundary>
  );
};

const BalanceUsage = ({
  copy,
  data,
  locale,
  onRetry,
}: {
  copy: CustomerCenterCopy;
  data: CustomerCenterData;
  locale: string;
  onRetry?: () => void;
}) => {
  return (
    <Flexbox gap={20}>
      <FormGroup collapsible={false} gap={16} title={copy.balancesTitle} variant="filled">
        <Balances copy={copy} locale={locale} state={data.balances} onRetry={onRetry} />
      </FormGroup>
      <FormGroup
        collapsible={false}
        gap={16}
        title={copy.usageSummaryTitle || copy.sections['balance-usage']}
        variant="filled"
      >
        <Usage copy={copy} locale={locale} state={data.usage} onRetry={onRetry} />
      </FormGroup>
    </Flexbox>
  );
};

const RechargeRow = ({
  copy,
  locale,
  record,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  record: CustomerRechargeRecord;
}) => {
  return (
    <Flexbox horizontal className={styles.row} gap={16} justify="space-between">
      <Flexbox gap={4} style={{ minWidth: 0 }}>
        <Text ellipsis weight={600}>
          {copy.ledgerEntryType?.[record.kind] || copy.defaultRechargeSource}
        </Text>
        <Flexbox horizontal align="center" gap={6}>
          <Icon icon={Clock3Icon} size={13} />
          <Text fontSize={13} type="secondary">
            {formatCustomerDateTime(record.occurredAt, locale)}
          </Text>
        </Flexbox>
      </Flexbox>
      <Text className={styles.metricValue} weight={600}>
        {copy.creditsChangeLabel} {formatSignedCredits(record.creditDelta, locale)}
      </Text>
    </Flexbox>
  );
};

const ServiceOrderRow = ({
  copy,
  locale,
  order,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  order: CustomerServiceOrder;
}) => {
  const { money } = useMonthlyExchangeRate();
  return (
    <Flexbox horizontal className={styles.row} gap={16} justify="space-between">
      <Flexbox gap={4} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" gap={8}>
          <Text ellipsis weight={600}>
            {order.title}
          </Text>
          <Tag>{copy.orderStatus?.[order.status] || order.status}</Tag>
        </Flexbox>
        <Flexbox horizontal align="center" gap={6}>
          <Icon icon={Clock3Icon} size={13} />
          <Text fontSize={13} type="secondary">
            {formatCustomerDateTime(order.occurredAt, locale)}
          </Text>
        </Flexbox>
      </Flexbox>
      <Text className={styles.metricValue} weight={600}>
        {Number.isSafeInteger(order.amountFen) && order.amountFen >= 0
          ? money(order.amountFen / 100, 'CNY')
          : '—'}
      </Text>
    </Flexbox>
  );
};

const PageControls = ({
  control,
  copy,
}: {
  control?: CustomerCenterPaginationControl;
  copy?: CustomerCenterCopy;
}) => {
  const translateTravel = useTravelTranslation();
  if (!control || (!control.canGoBack && !control.canGoForward)) return null;

  return (
    <Flexbox horizontal gap={8} justify="flex-end" paddingBlock={12}>
      <Button disabled={!control.canGoBack || control.isLoading} onClick={control.onBack}>
        {copy?.pagePreviousLabel || translateTravel('上一页')}
      </Button>
      <Button disabled={!control.canGoForward || control.isLoading} onClick={control.onForward}>
        {copy?.pageNextLabel || translateTravel('下一页')}
      </Button>
    </Flexbox>
  );
};

const RechargeHistory = ({
  copy,
  locale,
  onRetryOrders,
  onRetryRecharges,
  orderPagination,
  orders,
  pagination,
  state,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  onRetryOrders?: () => void;
  onRetryRecharges?: () => void;
  orderPagination?: CustomerCenterPaginationControl;
  orders: CustomerCenterData['orders'];
  pagination?: CustomerCenterPaginationControl;
  state: CustomerCenterData['recharges'];
}) => {
  const translateTravel = useTravelTranslation();
  return (
    <Flexbox gap={20}>
      <FormGroup collapsible={false} gap={16} title={copy.rechargeTitle} variant="filled">
        <DataBoundary
          emptyDescription={copy.rechargeEmpty}
          state={state}
          onRetry={onRetryRecharges}
        >
          {(records) =>
            records.length === 0 ? (
              <Flexbox>
                <Empty description={copy.rechargeEmpty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                <PageControls control={pagination} copy={copy} />
              </Flexbox>
            ) : (
              <Flexbox>
                {records.map((record, index) => (
                  <div key={record.id}>
                    {index > 0 && <Divider style={{ margin: 0 }} />}
                    <RechargeRow copy={copy} locale={locale} record={record} />
                  </div>
                ))}
                <PageControls control={pagination} copy={copy} />
              </Flexbox>
            )
          }
        </DataBoundary>
      </FormGroup>
      <FormGroup
        collapsible={false}
        gap={16}
        title={copy.ordersTitle || translateTravel('服务订单')}
        variant="filled"
      >
        <DataBoundary
          emptyDescription={copy.ordersEmpty || translateTravel('暂无服务订单')}
          state={orders}
          onRetry={onRetryOrders}
        >
          {(items) =>
            items.length === 0 ? (
              <Flexbox>
                <Empty
                  description={copy.ordersEmpty || translateTravel('暂无服务订单')}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
                <PageControls control={orderPagination} copy={copy} />
              </Flexbox>
            ) : (
              <Flexbox>
                {items.slice(0, CUSTOMER_CENTER_VISIBLE_PAGE_LIMIT).map((order, index) => (
                  <div key={order.id}>
                    {index > 0 && <Divider style={{ margin: 0 }} />}
                    <ServiceOrderRow copy={copy} locale={locale} order={order} />
                  </div>
                ))}
                <PageControls control={orderPagination} copy={copy} />
              </Flexbox>
            )
          }
        </DataBoundary>
      </FormGroup>
    </Flexbox>
  );
};

const statusColor = (
  status: CustomerCreationStatus,
): 'error' | 'processing' | 'success' | 'default' => {
  if (status === 'failed') return 'error';
  if (status === 'processing') return 'processing';
  if (status === 'succeeded') return 'success';
  return 'default';
};

const ItemTitle = ({ href, title }: { href?: string; title: string }) => {
  return href ? (
    <Link className={`${styles.link} ${styles.itemTitle}`} title={title} to={href}>
      <Text ellipsis as="span" weight={600}>
        {title}
      </Text>
    </Link>
  ) : (
    <Text ellipsis className={styles.itemTitle} title={title} weight={600}>
      {title}
    </Text>
  );
};

const TaskRow = ({
  copy,
  item,
  locale,
  onOpen,
}: {
  copy: CustomerCenterCopy;
  item: CustomerGenerationTask;
  locale: string;
  onOpen?: (id: string) => void;
}) => {
  const translateTravel = useTravelTranslation();
  return (
    <Flexbox className={styles.row} gap={6}>
      <div className={styles.rowHeading}>
        <ItemTitle title={item.title || copy.generationTasksTitle} />
        <Tag color={statusColor(item.status)}>
          {copy.creationStatus[getCreationStatusKey(item.status)]}
        </Tag>
      </div>
      <Flexbox horizontal className={styles.rowMeta} gap={10}>
        <Text fontSize={13} type="secondary">
          {formatCustomerDateTime(item.createdAt || item.updatedAt, locale)}
        </Text>
        {onOpen && (
          <Button size="small" type="text" onClick={() => onOpen(item.id)}>
            {translateTravel('查看详情')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
};

const WorkRow = ({
  copy,
  item,
  locale,
}: {
  copy: CustomerCenterCopy;
  item: CustomerWork;
  locale: string;
}) => {
  return (
    <Flexbox className={styles.row} gap={6}>
      <ItemTitle href={item.href} title={item.title || copy.worksTitle} />
      <Flexbox horizontal className={styles.rowMeta} gap={10}>
        <Text fontSize={13} type="secondary">
          {formatCustomerDateTime(item.updatedAt, locale)}
        </Text>
      </Flexbox>
    </Flexbox>
  );
};

const CUSTOMER_CENTER_VISIBLE_PAGE_LIMIT = 20;

const CreationList = <T extends { id: string }>({
  emptyDescription,
  icon,
  items,
  pagination,
  renderItem,
  title,
}: {
  emptyDescription: string;
  icon: ReactNode;
  items: T[];
  pagination?: CustomerCenterPaginationControl;
  renderItem: (item: T) => ReactNode;
  title: string;
}) => {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={styles.creationList}>
      <Block padding={20} variant="outlined">
        <Flexbox horizontal align="center" className={styles.creationListHeader} gap={8}>
          {icon}
          <Text as="h2" id={headingId} weight={600}>
            {title}
          </Text>
        </Flexbox>
        <Divider style={{ marginBlock: 12 }} />
        {items.length === 0 ? (
          <Flexbox>
            <Empty description={emptyDescription} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            <PageControls control={pagination} />
          </Flexbox>
        ) : (
          <Flexbox>
            {items.slice(0, CUSTOMER_CENTER_VISIBLE_PAGE_LIMIT).map((item, index) => (
              <div key={item.id}>
                {index > 0 && <Divider style={{ margin: 0 }} />}
                {renderItem(item)}
              </div>
            ))}
            <PageControls control={pagination} copy={undefined} />
          </Flexbox>
        )}
      </Block>
    </section>
  );
};

const CreationFilters = ({
  filters = {},
  onChange,
}: {
  filters?: CustomerGenerationFilters;
  onChange?: (filters: CustomerGenerationFilters) => void;
}) => {
  const translateTravel = useTravelTranslation();
  if (!onChange) return null;

  return (
    <div aria-label={translateTravel('生成筛选条件')} className={styles.filters} role="group">
      <div className={styles.filterSelectWrap}>
        <select
          aria-label={translateTravel('生成类型')}
          className={`${styles.filterControl} ${styles.filterSelect}`}
          value={filters.type || ''}
          onChange={(event) =>
            onChange({
              ...filters,
              type: (event.target.value || undefined) as CustomerGenerationFilters['type'],
            })
          }
        >
          <option value="">{translateTravel('全部类型')}</option>
          <option value="copy">{translateTravel('文案')}</option>
          <option value="image">{translateTravel('图片')}</option>
          <option value="document">{translateTravel('文稿')}</option>
          <option value="video">{translateTravel('视频')}</option>
        </select>
        <span aria-hidden className={styles.filterSelectIcon}>
          <ChevronDownIcon size={16} />
        </span>
      </div>
      <div className={styles.filterSelectWrap}>
        <select
          aria-label={translateTravel('生成状态')}
          className={`${styles.filterControl} ${styles.filterSelect}`}
          value={filters.status || ''}
          onChange={(event) =>
            onChange({
              ...filters,
              status: (event.target.value || undefined) as CustomerGenerationFilters['status'],
            })
          }
        >
          <option value="">{translateTravel('全部状态')}</option>
          <option value="processing">{translateTravel('制作中')}</option>
          <option value="succeeded">{translateTravel('已完成')}</option>
          <option value="failed">{translateTravel('失败')}</option>
          <option value="unavailable">{translateTravel('当前不可用')}</option>
        </select>
        <span aria-hidden className={styles.filterSelectIcon}>
          <ChevronDownIcon size={16} />
        </span>
      </div>
      <input
        aria-label={translateTravel('开始日期')}
        className={styles.filterControl}
        type="date"
        value={filters.dateFrom || ''}
        onChange={(event) => onChange({ ...filters, dateFrom: event.target.value || undefined })}
      />
      <input
        aria-label={translateTravel('结束日期')}
        className={styles.filterControl}
        type="date"
        value={filters.dateTo || ''}
        onChange={(event) => onChange({ ...filters, dateTo: event.target.value || undefined })}
      />
    </div>
  );
};

const GenerationDetailPanel = ({
  copy,
  locale,
  onClose,
  onRetry,
  state,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  onClose?: () => void;
  onRetry?: () => void;
  state?: CustomerCenterDataState<CustomerGenerationDetail>;
}) => {
  const translateTravel = useTravelTranslation();
  if (!state) return null;

  return (
    <Block gap={12} padding={20} variant="outlined">
      <Flexbox horizontal align="center" justify="space-between">
        <Text weight={600}>{translateTravel('生成详情')}</Text>
        {onClose && (
          <Button size="small" type="text" onClick={onClose}>
            {translateTravel('关闭')}
          </Button>
        )}
      </Flexbox>
      <DataBoundary emptyDescription={copy.creationsUnavailable} state={state} onRetry={onRetry}>
        {(detail) => (
          <Flexbox gap={10}>
            <Flexbox horizontal className={styles.rowMeta} gap={12}>
              <Tag>{detail.type}</Tag>
              <Tag color={statusColor(detail.status)}>
                {copy.creationStatus[getCreationStatusKey(detail.status)]}
              </Tag>
              <Text type="secondary">{formatCustomerDateTime(detail.createdAt, locale)}</Text>
            </Flexbox>
            {detail.isVideoUnavailable ? (
              <Alert
                showIcon
                title={copy.generationUnavailableVideo || translateTravel('视频生成功能当前不可用')}
                type="warning"
              />
            ) : detail.settlementStatus === 'pending' ? (
              <Alert
                showIcon
                title={copy.generationSettlementPending || translateTravel('结算完成后可查看成果')}
                type="warning"
              />
            ) : detail.artifacts.length === 0 ? (
              <Empty description={copy.worksEmpty} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Flexbox gap={8}>
                {detail.artifacts.map((artifact, index) => {
                  const label = artifact.name || artifact.id || artifact.type;
                  return (
                    <Flexbox
                      gap={4}
                      key={`${artifact.type}-${artifact.id || artifact.url || index}`}
                    >
                      {artifact.href ? (
                        <Link className={styles.link} to={artifact.href}>
                          {label}
                        </Link>
                      ) : artifact.url ? (
                        <a className={styles.link} href={artifact.url} rel="noreferrer">
                          {label}
                        </a>
                      ) : (
                        <Text>{label}</Text>
                      )}
                      {artifact.content && <Text type="secondary">{artifact.content}</Text>}
                    </Flexbox>
                  );
                })}
              </Flexbox>
            )}
          </Flexbox>
        )}
      </DataBoundary>
    </Block>
  );
};

const MyCreations = ({
  copy,
  detail,
  filters,
  locale,
  onCloseDetail,
  onFiltersChange,
  onOpenDetail,
  onRetry,
  onRetryDetail,
  pagination,
  state,
}: {
  copy: CustomerCenterCopy;
  detail?: CustomerCenterDataState<CustomerGenerationDetail>;
  filters?: CustomerGenerationFilters;
  locale: string;
  onCloseDetail?: () => void;
  onFiltersChange?: (filters: CustomerGenerationFilters) => void;
  onOpenDetail?: (id: string) => void;
  onRetry?: () => void;
  onRetryDetail?: () => void;
  pagination?: CustomerCenterPagination;
  state: CustomerCenterData['creations'];
}) => {
  return (
    <Flexbox gap={16}>
      <CreationFilters filters={filters} onChange={onFiltersChange} />
      <DataBoundary emptyDescription={copy.creationsUnavailable} state={state} onRetry={onRetry}>
        {(creations) => (
          <div className={styles.creationGrid}>
            <CreationList
              emptyDescription={copy.generationTasksEmpty}
              icon={<Icon color={cssVar.colorPrimary} icon={SparklesIcon} size={18} />}
              items={creations.generationTasks}
              pagination={pagination?.generationTasks}
              title={copy.generationTasksTitle}
              renderItem={(item) => (
                <TaskRow copy={copy} item={item} locale={locale} onOpen={onOpenDetail} />
              )}
            />
            <CreationList
              emptyDescription={copy.worksEmpty}
              icon={<Icon color={cssVar.colorPrimary} icon={FileOutputIcon} size={18} />}
              items={creations.works}
              pagination={pagination?.works}
              renderItem={(item) => <WorkRow copy={copy} item={item} locale={locale} />}
              title={copy.worksTitle}
            />
          </div>
        )}
      </DataBoundary>
      <GenerationDetailPanel
        copy={copy}
        locale={locale}
        state={detail}
        onClose={onCloseDetail}
        onRetry={onRetryDetail}
      />
    </Flexbox>
  );
};

const CustomerCenter = ({
  copy,
  data,
  defaultSection = 'account-security',
  generationDetail,
  generationFilters,
  locale,
  onCloseGenerationDetail,
  onGenerationFiltersChange,
  onOpenGenerationDetail,
  onRefresh,
  onRetryCreations,
  onRetryGenerationDetail,
  onRetryOrders,
  onRetryOverview,
  onRetryRecharges,
  pagination,
}: CustomerCenterProps) => {
  const translateTravel = useTravelTranslation();
  const [searchParams] = useSearchParams();
  const requestedSection = resolveCustomerCenterSection(searchParams.get('section'));
  const activeSection = requestedSection || defaultSection;

  return (
    <Flexbox className={styles.page} gap={20}>
      {activeSection === 'account-security' && (
        <Flexbox gap={20}>
          <AccountSecurity copy={copy} locale={locale} />
        </Flexbox>
      )}
      {activeSection === 'balance-usage' && (
        <BalanceUsage copy={copy} data={data} locale={locale} onRetry={onRetryOverview} />
      )}
      {activeSection === 'plans' && (
        <Flexbox gap={20}>
          <Balances copy={copy} locale={locale} state={data.balances} onRetry={onRetryOverview} />
          <CreditsOrders locale={locale} />
        </Flexbox>
      )}
      {activeSection === 'recharge-history' && (
        <Flexbox gap={20}>
          <CreditsOrders locale={locale} />
          <RechargeHistory
            copy={copy}
            locale={locale}
            orderPagination={pagination?.orders}
            orders={data.orders}
            pagination={pagination?.recharges}
            state={data.recharges}
            onRetryOrders={onRetryOrders}
            onRetryRecharges={onRetryRecharges}
          />
        </Flexbox>
      )}
      {activeSection === 'my-creations' && (
        <MyCreations
          copy={copy}
          detail={generationDetail}
          filters={generationFilters}
          locale={locale}
          pagination={pagination}
          state={data.creations}
          onCloseDetail={onCloseGenerationDetail}
          onFiltersChange={onGenerationFiltersChange}
          onOpenDetail={onOpenGenerationDetail}
          onRetry={onRetryCreations}
          onRetryDetail={onRetryGenerationDetail}
        />
      )}
    </Flexbox>
  );
};

export default CustomerCenter;
