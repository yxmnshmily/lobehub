'use client';

import { formatLocalizedTokens } from '@lobechat/utils/format';
import { Flexbox, FormGroup } from '@lobehub/ui';
import { Alert, Button, Tag, Text } from '@lobehub/ui/base-ui';
import { Divider, Empty } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { ShoppingCart } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  CREDIT_PURCHASE_MAX_QUANTITY,
  CREDIT_PURCHASE_QUANTITIES,
  CREDIT_PURCHASE_UNIT,
} from '@/const/creditPurchase';
import SkeletonText from '@/components/Skeleton/Text';
import { lambdaQuery } from '@/libs/trpc/client';
import { useTravelTranslation } from '@/utils/i18n/travel';

import { formatCredits, formatCustomerDateTime } from './model';
import { openPaymentCheckout } from './PaymentCheckout';
import { useMonthlyExchangeRate } from './useMonthlyExchangeRate';

interface CreditsOrdersProps {
  locale: string;
}

type Feedback = { message: string; type: 'error' | 'success' };

const styles = createStaticStyles(({ css, responsive }) => ({
  packages: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 12px;

    button {
      min-height: 44px;
      font-variant-numeric: tabular-nums;
    }

    button[aria-pressed='true'] {
      border-color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  purchase: css`
    scroll-margin-block: 24px;
    min-width: 0;

    input {
      box-sizing: border-box;
      width: 100%;
      max-width: 240px;
      min-height: 44px;
      padding-block: 10px;
      padding-inline: 12px;
      border: 0.5px solid ${cssVar.colorBorder};
      border-radius: 8px;

      color: ${cssVar.colorText};

      background: ${cssVar.colorBgContainer};
    }

    input:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  actions: css`
    flex: none;
    flex-wrap: wrap;
  `,
  list: css`
    overflow: hidden;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
  `,
  row: css`
    min-width: 0;
    padding: 12px;

    ${responsive.sm} {
      flex-direction: column;
      align-items: flex-start;
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

const CreditsOrders = ({ locale }: CreditsOrdersProps) => {
  const translateTravel = useTravelTranslation();
  const { money: formatAmount } = useMonthlyExchangeRate();
  const money = (amountMinor: number, currency: string) =>
    !Number.isSafeInteger(amountMinor) || amountMinor < 0
      ? '—'
      : formatAmount(amountMinor / 100, currency);
  const [busyAction, setBusyAction] = useState<string>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [quantity, setQuantity] = useState('1');
  const units = Number(quantity);
  const validQuantity =
    Number.isInteger(units) && units >= 1 && units <= CREDIT_PURCHASE_MAX_QUANTITY;
  const actionInFlight = useRef(false);
  const ordersQuery = lambdaQuery.platformCreditPurchase.listOrders.useQuery(
    { limit: 20 },
    { retry: false, refetchOnMount: 'always', refetchOnWindowFocus: true },
  );
  const checkoutConfig = lambdaQuery.platformCreditPurchase.checkoutConfig.useQuery(undefined, {
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const priceReady =
    !checkoutConfig.isLoading &&
    !checkoutConfig.isError &&
    typeof checkoutConfig.data?.unitAmountMinor === 'number' &&
    checkoutConfig.data.unitAmountMinor > 0;
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

  const handleCreate = () => {
    if (!validQuantity || !priceReady) return;
    openPaymentCheckout({ quantity: units, onChanged: () => void ordersQuery.refetch() });
  };

  const orders = ordersQuery.data ?? [];

  return (
    <Flexbox gap={24}>
      <div className={styles.purchase} id="credit-purchase">
        <FormGroup
          collapsible={false}
          gap={16}
          title={translateTravel('积分充值')}
          variant="filled"
        >
          <Flexbox gap={24} style={{ minWidth: 0 }}>
            <Alert
              showIcon
              title={translateTravel('选择支付方式并完成付款，付款确认后自动入账。')}
              type="info"
            />
            {feedback && <Alert showIcon title={feedback.message} type={feedback.type} />}
            <Flexbox gap={12}>
              <Text weight={600}>{translateTravel('选择积分包')}</Text>
              <div
                aria-label={translateTravel('选择积分包')}
                className={styles.packages}
                role="group"
              >
                {CREDIT_PURCHASE_QUANTITIES.map((value) => (
                  <Button
                    aria-pressed={units === value}
                    disabled={Boolean(busyAction)}
                    key={value}
                    onClick={() => setQuantity(String(value))}
                  >
                    {formatLocalizedTokens(value * CREDIT_PURCHASE_UNIT.credits, locale)}
                  </Button>
                ))}
              </div>
            </Flexbox>
            <Flexbox gap={12}>
              <label htmlFor="credit-quantity">
                {translateTravel('自定义数量（每份 100 万积分）')}
              </label>
              <input
                aria-describedby={!validQuantity ? 'credit-quantity-error' : undefined}
                aria-invalid={!validQuantity}
                disabled={Boolean(busyAction)}
                id="credit-quantity"
                max={CREDIT_PURCHASE_MAX_QUANTITY}
                min={1}
                step={1}
                type="number"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              {!validQuantity && (
                <Text id="credit-quantity-error" type="danger">
                  {translateTravel('请输入 1 至 500 的整数')}
                </Text>
              )}
            </Flexbox>
            <Text
              fontSize={12}
              type="secondary"
              style={{
                display: 'block',
                lineHeight: 1.7,
                whiteSpace: 'normal',
                overflowWrap: 'anywhere',
              }}
            >
              {translateTravel('新充值订单使用人民币结算，旧订单保留原币种与金额。')}
            </Text>

            <Divider style={{ margin: 0 }} />
            <Flexbox
              horizontal
              align="center"
              className={styles.row}
              gap={16}
              justify="space-between"
            >
              <Flexbox gap={4}>
                <Text weight={600}>
                  {validQuantity
                    ? formatCredits(units * CREDIT_PURCHASE_UNIT.credits, locale)
                    : '—'}{' '}
                  {translateTravel('积分')}
                </Text>
                <Text fontSize={24} weight={600}>
                  {translateTravel('总计')}{' '}
                  {validQuantity && priceReady && checkoutConfig.data?.unitAmountMinor
                    ? new Intl.NumberFormat('zh-CN', {
                        style: 'currency',
                        currency: 'CNY',
                        currencyDisplay: 'narrowSymbol',
                      }).format((units * checkoutConfig.data.unitAmountMinor) / 100)
                    : '—'}
                </Text>
                <Text type="secondary">
                  {translateTravel(
                    checkoutConfig.isLoading
                      ? '正在加载充值价格…'
                      : checkoutConfig.isError || !checkoutConfig.data
                        ? '充值价格暂时无法读取'
                        : priceReady
                          ? '人民币收款，到账积分以本订单为准。'
                          : '人民币售价待配置',
                  )}
                </Text>
                {!checkoutConfig.isLoading && (checkoutConfig.isError || !checkoutConfig.data) && (
                  <Button onClick={() => void checkoutConfig.refetch()}>
                    {translateTravel('重新加载充值价格')}
                  </Button>
                )}
              </Flexbox>
              <Button
                disabled={Boolean(busyAction) || !validQuantity || !priceReady}
                loading={busyAction === 'create'}
                type="primary"
                onClick={() => void handleCreate()}
              >
                <ShoppingCart size={16} />
                {translateTravel('充值')}
              </Button>
            </Flexbox>
          </Flexbox>
        </FormGroup>
      </div>
      <div className={styles.purchase} id="credit-orders">
        <FormGroup
          collapsible={false}
          gap={16}
          title={translateTravel('我的充值订单')}
          variant="filled"
        >
          <Flexbox gap={16} style={{ minWidth: 0 }}>
            <Text type="secondary">
              {translateTravel('显示最近 20 条订单；只有已到账订单会增加可用积分。')}
            </Text>
            {ordersQuery.isLoading ? (
              <SkeletonText rows={2} />
            ) : ordersQuery.isError ? (
              <Alert
                showIcon
                title={translateTravel('充值订单暂时无法读取。')}
                type="error"
                action={
                  <Button onClick={() => void ordersQuery.refetch()}>
                    {translateTravel('重新读取订单')}
                  </Button>
                }
              />
            ) : orders.length === 0 ? (
              <Empty
                description={translateTravel('暂无充值订单')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <div className={styles.list}>
                {orders.map((order, index) => {
                  const actionKey = `cancel:${order.id}`;
                  const domestic = order.productId.startsWith('domestic-credits-');
                  const canContinue =
                    domestic && ['created', 'payment_pending'].includes(order.status);
                  const canCancel =
                    cancellableStatuses.has(order.status) &&
                    !(domestic && order.status === 'payment_pending');
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
                            <Text weight={600}>
                              {formatCredits(order.credits, locale)} {translateTravel('积分')}
                            </Text>
                            <Tag>{translateTravel(statusCopy[order.status] || '状态未知')}</Tag>
                          </Flexbox>
                          <Flexbox horizontal className={styles.rowMeta} gap={10}>
                            <Text type="secondary">{money(order.amountMinor, order.currency)}</Text>
                            <Text type="secondary">
                              {formatCustomerDateTime(order.createdAt, locale)}
                            </Text>
                          </Flexbox>
                        </Flexbox>
                        {(canCancel || canContinue) && (
                          <Flexbox horizontal className={styles.actions} gap={8}>
                            {canContinue && (
                              <Button
                                onClick={() =>
                                  openPaymentCheckout({
                                    quantity: order.credits / CREDIT_PURCHASE_UNIT.credits,
                                    initialOrder: order,
                                    onChanged: () => void ordersQuery.refetch(),
                                  })
                                }
                              >
                                {translateTravel('继续支付')}
                              </Button>
                            )}
                            {canCancel && (
                              <Button
                                danger
                                aria-label={translateTravel('取消待支付订单')}
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
                                    translateTravel('待支付订单已取消。'),
                                    translateTravel('订单未取消，可能已变更状态，请刷新后重试。'),
                                  )
                                }
                              >
                                {translateTravel('取消订单')}
                              </Button>
                            )}
                          </Flexbox>
                        )}
                      </Flexbox>
                    </div>
                  );
                })}
              </div>
            )}
          </Flexbox>
        </FormGroup>
      </div>
    </Flexbox>
  );
};

export default CreditsOrders;
