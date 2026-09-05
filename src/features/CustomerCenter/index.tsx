'use client';

import { Block, Flexbox, FormGroup, Icon } from '@lobehub/ui';
import { Alert, Button, Tabs, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider, Empty, Skeleton } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import {
  BadgeCentIcon,
  CircleUserRoundIcon,
  Clock3Icon,
  CoinsIcon,
  FileOutputIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import AvatarRow from '@/features/Settings/profile/features/AvatarRow';
import FullNameRow from '@/features/Settings/profile/features/FullNameRow';
import PasswordRow from '@/features/Settings/profile/features/PasswordRow';

import CreditsOrders from './CreditsOrders';
import GroupInvitations from './GroupInvitations';
import LoginSessions from './LoginSessions';
import {
  CUSTOMER_CENTER_SECTIONS,
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

    ${responsive.md} {
      grid-template-columns: 1fr;
    }
  `,
  filters: css`
    flex-wrap: wrap;
  `,
  filterControl: css`
    min-width: 148px;
    min-height: 32px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;

    color: ${cssVar.colorText};

    color-scheme: light dark;
    background: ${cssVar.colorBgContainer};
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
    max-width: 960px;
    margin-block: 0;
    margin-inline: auto;
    padding: 24px;

    ${responsive.sm} {
      padding: 16px;
    }
  `,
  row: css`
    padding-block: 14px;
  `,
  rowMeta: css`
    flex-wrap: wrap;
  `,
  tabs: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    overflow-x: auto;

    background: ${cssVar.colorBgLayout};

    ${responsive.sm} {
      overflow-x: visible;

      [role='tablist'] {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        width: 100%;
      }

      [role='tab'] {
        justify-content: center;
        min-width: 0;
        min-height: 44px;
        margin: 0 !important;
        padding: 8px;
        white-space: normal;
      }

      [role='presentation'] {
        display: none;
      }
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
  if (state.isLoading) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  if (state.error)
    return (
      <Alert
        showIcon
        action={onRetry ? <Button onClick={onRetry}>重试</Button> : undefined}
        title={state.error}
        type="error"
      />
    );
  if (state.isUnavailable) return <Alert showIcon title={emptyDescription} type="warning" />;
  if (state.data === undefined)
    return <Empty description={emptyDescription} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return children(state.data);
};

const AccountSecurity = ({ copy, locale }: { copy: CustomerCenterCopy; locale: string }) => (
  <FormGroup collapsible={false} gap={16} title={copy.accountSecurityTitle} variant="filled">
    <AvatarRow />
    <Divider style={{ margin: 0 }} />
    <FullNameRow />
    <Divider style={{ margin: 0 }} />
    <PasswordRow />
    {copy.sessionSecurityNotice && (
      <>
        <Divider style={{ margin: 0 }} />
        <Alert showIcon title={copy.sessionSecurityNotice} type="info" />
      </>
    )}
    <Divider style={{ margin: 0 }} />
    <LoginSessions locale={locale} />
  </FormGroup>
);

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
}) => (
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
}) => (
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
}) => (
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

const RechargeRow = ({
  copy,
  locale,
  record,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  record: CustomerRechargeRecord;
}) => (
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

const formatCnyFen = (amountFen: number, locale: string): string =>
  Number.isSafeInteger(amountFen) && amountFen >= 0
    ? new Intl.NumberFormat(locale, { currency: 'CNY', style: 'currency' }).format(amountFen / 100)
    : '—';

const ServiceOrderRow = ({
  copy,
  locale,
  order,
}: {
  copy: CustomerCenterCopy;
  locale: string;
  order: CustomerServiceOrder;
}) => (
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
      {formatCnyFen(order.amountFen, locale)}
    </Text>
  </Flexbox>
);

const PageControls = ({
  control,
  copy,
}: {
  control?: CustomerCenterPaginationControl;
  copy?: CustomerCenterCopy;
}) => {
  if (!control || (!control.canGoBack && !control.canGoForward)) return null;

  return (
    <Flexbox horizontal gap={8} justify="flex-end" paddingBlock={12}>
      <Button disabled={!control.canGoBack || control.isLoading} onClick={control.onBack}>
        {copy?.pagePreviousLabel || '上一页'}
      </Button>
      <Button disabled={!control.canGoForward || control.isLoading} onClick={control.onForward}>
        {copy?.pageNextLabel || '下一页'}
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
}) => (
  <Flexbox gap={20}>
    <FormGroup collapsible={false} gap={16} title={copy.rechargeTitle} variant="filled">
      <DataBoundary emptyDescription={copy.rechargeEmpty} state={state} onRetry={onRetryRecharges}>
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
    <FormGroup collapsible={false} gap={16} title={copy.ordersTitle || '服务订单'} variant="filled">
      <DataBoundary
        emptyDescription={copy.ordersEmpty || '暂无服务订单'}
        state={orders}
        onRetry={onRetryOrders}
      >
        {(items) =>
          items.length === 0 ? (
            <Flexbox>
              <Empty
                description={copy.ordersEmpty || '暂无服务订单'}
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

const statusColor = (
  status: CustomerCreationStatus,
): 'error' | 'processing' | 'success' | 'default' => {
  if (status === 'failed') return 'error';
  if (status === 'processing') return 'processing';
  if (status === 'succeeded') return 'success';
  return 'default';
};

const ItemTitle = ({ href, title }: { href?: string; title: string }) =>
  href ? (
    <Link className={styles.link} to={href}>
      <Text ellipsis weight={600}>
        {title}
      </Text>
    </Link>
  ) : (
    <Text ellipsis weight={600}>
      {title}
    </Text>
  );

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
}) => (
  <Flexbox className={styles.row} gap={6}>
    <Flexbox horizontal align="center" gap={8} justify="space-between">
      <ItemTitle title={item.title || copy.generationTasksTitle} />
      <Tag color={statusColor(item.status)}>
        {copy.creationStatus[getCreationStatusKey(item.status)]}
      </Tag>
    </Flexbox>
    <Flexbox horizontal className={styles.rowMeta} gap={10}>
      <Text fontSize={13} type="secondary">
        {formatCustomerDateTime(item.createdAt || item.updatedAt, locale)}
      </Text>
      {onOpen && (
        <Button size="small" type="text" onClick={() => onOpen(item.id)}>
          查看详情
        </Button>
      )}
    </Flexbox>
  </Flexbox>
);

const WorkRow = ({
  copy,
  item,
  locale,
}: {
  copy: CustomerCenterCopy;
  item: CustomerWork;
  locale: string;
}) => (
  <Flexbox className={styles.row} gap={6}>
    <ItemTitle href={item.href} title={item.title || copy.worksTitle} />
    <Flexbox horizontal className={styles.rowMeta} gap={10}>
      <Text fontSize={13} type="secondary">
        {formatCustomerDateTime(item.updatedAt, locale)}
      </Text>
    </Flexbox>
  </Flexbox>
);

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
}) => (
  <Block padding={20} variant="outlined">
    <Flexbox horizontal align="center" gap={8}>
      {icon}
      <Text weight={600}>{title}</Text>
    </Flexbox>
    <Divider />
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
);

const CreationFilters = ({
  filters = {},
  onChange,
}: {
  filters?: CustomerGenerationFilters;
  onChange?: (filters: CustomerGenerationFilters) => void;
}) => {
  if (!onChange) return null;

  return (
    <Flexbox horizontal className={styles.filters} gap={8}>
      <select
        aria-label="生成类型"
        className={styles.filterControl}
        value={filters.type || ''}
        onChange={(event) =>
          onChange({
            ...filters,
            type: (event.target.value || undefined) as CustomerGenerationFilters['type'],
          })
        }
      >
        <option value="">全部类型</option>
        <option value="copy">文案</option>
        <option value="image">图片</option>
        <option value="document">文稿</option>
        <option value="video">视频</option>
      </select>
      <select
        aria-label="生成状态"
        className={styles.filterControl}
        value={filters.status || ''}
        onChange={(event) =>
          onChange({
            ...filters,
            status: (event.target.value || undefined) as CustomerGenerationFilters['status'],
          })
        }
      >
        <option value="">全部状态</option>
        <option value="processing">制作中</option>
        <option value="succeeded">已完成</option>
        <option value="failed">失败</option>
        <option value="unavailable">当前不可用</option>
      </select>
      <input
        aria-label="开始日期"
        className={styles.filterControl}
        type="date"
        value={filters.dateFrom || ''}
        onChange={(event) => onChange({ ...filters, dateFrom: event.target.value || undefined })}
      />
      <input
        aria-label="结束日期"
        className={styles.filterControl}
        type="date"
        value={filters.dateTo || ''}
        onChange={(event) => onChange({ ...filters, dateTo: event.target.value || undefined })}
      />
    </Flexbox>
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
  if (!state) return null;

  return (
    <Block gap={12} padding={20} variant="outlined">
      <Flexbox horizontal align="center" justify="space-between">
        <Text weight={600}>生成详情</Text>
        {onClose && (
          <Button size="small" type="text" onClick={onClose}>
            关闭
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
                title={copy.generationUnavailableVideo || '视频生成功能当前不可用'}
                type="warning"
              />
            ) : detail.settlementStatus === 'pending' ? (
              <Alert
                showIcon
                title={copy.generationSettlementPending || '结算完成后可查看成果'}
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
}) => (
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = resolveCustomerCenterSection(searchParams.get('section'));
  const [activeSection, setActiveSection] = useState<CustomerCenterSectionKey>(
    requestedSection || defaultSection,
  );
  const tabItems = useMemo(
    () =>
      CUSTOMER_CENTER_SECTIONS.map((section) => ({
        icon: (
          <Icon
            size={16}
            icon={
              section === 'account-security'
                ? ShieldCheckIcon
                : section === 'balance-usage'
                  ? CoinsIcon
                  : section === 'recharge-history'
                    ? BadgeCentIcon
                    : CircleUserRoundIcon
            }
          />
        ),
        key: section,
        label: copy.sections[section],
      })),
    [copy.sections],
  );

  useEffect(() => {
    setActiveSection(requestedSection || defaultSection);
  }, [defaultSection, requestedSection]);

  const changeSection = (section: string) => {
    const nextSection = resolveCustomerCenterSection(section);
    if (!nextSection) return;

    setActiveSection(nextSection);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('section', nextSection);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <Flexbox className={styles.page} gap={20}>
      <Flexbox horizontal align="center" gap={12} justify="space-between">
        <Text as="h1" fontSize={24} weight={700}>
          {copy.title}
        </Text>
        {onRefresh && <Button onClick={onRefresh}>刷新</Button>}
      </Flexbox>
      <div className={styles.tabs}>
        <Tabs activeKey={activeSection} items={tabItems} onChange={changeSection} />
      </div>
      {activeSection === 'account-security' && (
        <Flexbox gap={20}>
          <AccountSecurity copy={copy} locale={locale} />
          <GroupInvitations locale={locale} />
        </Flexbox>
      )}
      {activeSection === 'balance-usage' && (
        <BalanceUsage copy={copy} data={data} locale={locale} onRetry={onRetryOverview} />
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
