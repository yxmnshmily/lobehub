'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text } from '@lobehub/ui/base-ui';
import { Empty, Table } from 'antd';
import { ArrowLeftRight, Clock3, Coins, List, type LucideIcon, Wallet } from 'lucide-react';
import { useState } from 'react';

import SkeletonText from '@/components/Skeleton/Text';
import { lambdaQuery } from '@/libs/trpc/client';
import { getTravelLocale, translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

const labels: Record<string, string> = {
  get adjustment() {
    return translateTravel('人工调整');
  },
  get reversal() {
    return translateTravel('冲正');
  },
  get top_up() {
    return translateTravel('充值');
  },
  get usage_charge() {
    return translateTravel('使用扣费');
  },
};

const iconLabel = (Icon: LucideIcon, text: string) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <Icon aria-hidden size={16} style={{ flexShrink: 0 }} />
    {text}
  </span>
);

const PAGE_SIZE = 10;

const CreditLedger = () => {
  const translateTravel = useTravelTranslation();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const query = lambdaQuery.customerCenter.getPage.useQuery(
    { kind: 'ledger', limit: PAGE_SIZE, cursor: cursors.at(-1) },
    { retry: false },
  );
  if (query.isLoading) return <SkeletonText rows={3} />;
  if (query.isError)
    return (
      <Alert
        action={<Button onClick={() => void query.refetch()}>{translateTravel('重试')}</Button>}
        title={translateTravel('积分流水暂时无法读取')}
        type="error"
      />
    );
  const data = query.data;
  if (data?.kind !== 'ledger') return null;
  return (
    <section>
      <h2 style={{ marginBottom: 16 }}>{iconLabel(Coins, translateTravel('积分明细'))}</h2>
      <Table
        dataSource={data.items}
        pagination={false}
        rowKey="id"
        scroll={{ x: 600 }}
        size="middle"
        columns={[
          {
            title: iconLabel(Clock3, translateTravel('时间')),
            dataIndex: 'createdAt',
            render: (date) => new Date(date).toLocaleString(getTravelLocale(), { hour12: false }),
          },
          {
            title: iconLabel(List, translateTravel('类型')),
            dataIndex: 'type',
            render: (type: string) => labels[type] || type,
          },
          {
            title: iconLabel(ArrowLeftRight, translateTravel('积分变动')),
            dataIndex: 'amountCredits',
            render: (value: number) =>
              `${value > 0 ? '+' : ''}${value.toLocaleString(getTravelLocale())}`,
          },
          {
            title: iconLabel(Wallet, translateTravel('变动后余额')),
            dataIndex: 'balanceAfterCredits',
            render: (value?: number) =>
              value == null ? '—' : value.toLocaleString(getTravelLocale()),
          },
        ]}
        locale={{
          emptyText: (
            <Empty
              description={translateTravel('暂无积分流水')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ),
        }}
      />
      <Flexbox
        horizontal
        align="center"
        gap={16}
        justify="space-between"
        style={{ paddingTop: 16, flexWrap: 'wrap' }}
      >
        <Text type="secondary" role="status">
          {translateTravel('共 {{total}} 条 · 每页 {{pageSize}} 条', {
            total: data.total == null ? '—' : data.total.toLocaleString(getTravelLocale()),
            pageSize: PAGE_SIZE,
          })}
        </Text>
        <Flexbox horizontal gap={8} style={{ marginInlineStart: 'auto' }}>
          <Button
            disabled={cursors.length === 1 || query.isFetching}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            {translateTravel('上一页')}
          </Button>
          <Button
            disabled={!data.nextCursor || query.isFetching}
            onClick={() => {
              if (data.nextCursor) setCursors([...cursors, data.nextCursor]);
            }}
          >
            {translateTravel('下一页')}
          </Button>
        </Flexbox>
      </Flexbox>
    </section>
  );
};

export default CreditLedger;
