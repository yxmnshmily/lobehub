'use client';

import { Flexbox, FormGroup, Skeleton } from '@lobehub/ui';
import { Alert, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider, Empty } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { useRef, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';

import { formatCredits, formatCustomerDateTime } from './model';

interface CreditsOrdersProps {
  locale: string;
}

type Feedback = { message: string; type: 'error' | 'success' };

const styles = createStaticStyles(({ css, responsive }) => ({
  actions: css`
    flex: none;
    flex-wrap: wrap;
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  row: css`
    min-width: 0;
    padding: 12px;

    ${responsive.sm} {
      align-items: flex-start;
      flex-direction: column;
    }
  `,
  rowMeta: css`
    flex-wrap: wrap;
  `,
}));

const statusCopy: Record<string, string> = {
  cancelled: '已取消',
  created: '待支付',
  credited: '已到账',
  expired: '已过期',
  paid: '已付款待入账',
  payment_failed: '支付失败',
  payment_pending: '支付处理中',
  review_required: '人工核对',
};

const cancellableStatuses = new Set(['created', 'payment_failed', 'payment_pending']);

const formatMoney = (amountMinor: number, currency: string, locale: string) => {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency)) {
    return '—';
  }

  try {
    return new Intl.NumberFormat(locale, { currency, style: 'currency' }).format(amountMinor / 100);
  } catch {
    return '—';
  }
};

const CreditsOrders = ({ locale }: CreditsOrdersProps) => {
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const actionInFlight = useRef(false);
  const ordersQuery = lambdaQuery.platformCreditPurchase.listOrders.useQuery(
    { limit: 20 },
    { retry: false },
  );
  const createOrder = lambdaQuery.platformCreditPurchase.createOrder.useMutation();
  const cancelOrder = lambdaQuery.platformCreditPurchase.cancelOrder.useMutation();

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    successMessage: string,
    errorMessage: string,
  ) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusyAction(key);
    setFeedback(undefined);

    try {
      await action();
      setFeedback({ message: successMessage, type: 'success' });
      await ordersQuery.refetch().catch(() => undefined);
    } catch {
      setFeedback({ message: errorMessage, type: 'error' });
    } finally {
      actionInFlight.current = false;
      setBusyAction(undefined);
    }
  };

  const handleCreate = async () => {
    await runAction(
      'create',
      () =>
        createOrder.mutateAsync({
          idempotencyKey: crypto.randomUUID(),
          packageId: 'credits-1m',
        }),
      '订单已创建，但尚未付款或增加 Credits。',
      '订单未创建，请稍后重试。',
    );
  };

  const orders = ordersQuery.data ?? [];

  return (
    <FormGroup collapsible={false} gap={16} title="Credits 充值订单" variant="filled">
      <Alert
        showIcon
        title="尚未接入支付渠道；创建订单不会扣款，也不会自动增加 Credits。"
        type="warning"
      />
      {feedback && <Alert showIcon title={feedback.message} type={feedback.type} />}

      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <Flexbox gap={4}>
          <Text weight={600}>{formatCredits(1_000_000, locale)} Credits</Text>
          <Text type="secondary">{formatMoney(100, 'USD', locale)}</Text>
        </Flexbox>
        <Button
          disabled={Boolean(busyAction)}
          loading={busyAction === 'create'}
          type="primary"
          onClick={() => void handleCreate()}
        >
          创建充值订单
        </Button>
      </Flexbox>

      <Divider style={{ margin: 0 }} />
      <Text weight={600}>我的充值订单</Text>
      {ordersQuery.isLoading ? (
        <Skeleton active paragraph={{ rows: 2 }} title={false} />
      ) : ordersQuery.isError ? (
        <Alert
          showIcon
          action={<Button onClick={() => void ordersQuery.refetch()}>重新读取订单</Button>}
          title="充值订单暂时无法读取。"
          type="error"
        />
      ) : orders.length === 0 ? (
        <Empty description="暂无充值订单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <div className={styles.list}>
          {orders.map((order, index) => {
            const actionKey = `cancel:${order.id}`;
            const canCancel = cancellableStatuses.has(order.status);
            return (
              <div key={order.id}>
                {index > 0 && <Divider style={{ margin: 0 }} />}
                <Flexbox
                  horizontal
                  align="center"
                  className={styles.row}
                  gap={12}
                  justify="space-between"
                >
                  <Flexbox gap={4} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" className={styles.rowMeta} gap={8}>
                      <Text weight={600}>{formatCredits(order.credits, locale)} Credits</Text>
                      <Tag>{statusCopy[order.status] || '状态未知'}</Tag>
                    </Flexbox>
                    <Flexbox horizontal className={styles.rowMeta} gap={10}>
                      <Text type="secondary">
                        {formatMoney(order.amountMinor, order.currency, locale)}
                      </Text>
                      <Text type="secondary">
                        {formatCustomerDateTime(order.createdAt, locale)}
                      </Text>
                    </Flexbox>
                  </Flexbox>
                  {canCancel && (
                    <Flexbox horizontal className={styles.actions} gap={8}>
                      <Button
                        danger
                        aria-label="取消待支付订单"
                        disabled={Boolean(busyAction)}
                        loading={busyAction === actionKey}
                        onClick={() =>
                          void runAction(
                            actionKey,
                            () =>
                              cancelOrder.mutateAsync({
                                expectedVersion: order.version,
                                orderId: order.id,
                              }),
                            '待支付订单已取消。',
                            '订单未取消，可能已变更状态，请刷新后重试。',
                          )
                        }
                      >
                        取消订单
                      </Button>
                    </Flexbox>
                  )}
                </Flexbox>
              </div>
            );
          })}
        </div>
      )}
    </FormGroup>
  );
};

export default CreditsOrders;
