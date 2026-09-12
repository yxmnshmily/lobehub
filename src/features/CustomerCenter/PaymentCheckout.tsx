'use client';

import { AlipayCircleOutlined, BankOutlined, WechatOutlined } from '@ant-design/icons';
import { Flexbox } from '@lobehub/ui';
import { Alert, Button, createModal, Text } from '@lobehub/ui/base-ui';
import { QRCode } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { useEffect, useId, useRef, useState } from 'react';

import SkeletonText from '@/components/Skeleton/Text';
import { useSingleton } from '@/hooks/useSingleton';
import { lambdaQuery } from '@/libs/trpc/client';
import type { PaymentInstruction, PaymentMethod } from '@/server/services/domesticPayment/gateways';
import { translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

type CheckoutOrder = {
  id: string;
  amountMinor: number;
  credits: number;
  currency: string;
  status: string;
  productId: string;
  createdAt: Date | string;
};
interface Props {
  initialOrder?: CheckoutOrder;
  onChanged: () => void;
  quantity: number;
}
const choices = [
  { id: 'alipay', label: '支付宝', icon: AlipayCircleOutlined },
  { id: 'wechat', label: '微信支付', icon: WechatOutlined },
  { id: 'unionpay', label: '网银（银联）', icon: BankOutlined },
] as const;
const terminal = new Set(['credited', 'paid', 'review_required', 'cancelled', 'expired']);
const styles = createStaticStyles(({ css }) => ({
  methods: css`
    display: flex;
    flex-direction: column;
    gap: 12px;

    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;

    legend {
      margin-block-end: 12px;
      font-weight: 600;
    }

    label {
      cursor: pointer;

      display: flex;
      gap: 12px;
      align-items: center;

      min-height: 56px;
      padding-block: 12px;
      padding-inline: 16px;
      border: 0.5px solid ${cssVar.colorBorder};
      border-radius: 8px;
    }

    label:focus-within {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    label:has(input:checked) {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorFillTertiary};
    }

    label:has(input:disabled) {
      cursor: not-allowed;
      color: ${cssVar.colorTextSecondary};
    }

    input {
      accent-color: ${cssVar.colorPrimary};
    }
  `,
}));
const cny = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    currencyDisplay: 'narrowSymbol',
  }).format(amount / 100);

/** Shared display only. Callers decide availability; this component never creates an order. */
export const PaymentMethods = ({
  method,
  methods = [],
  disabled = false,
  onChange,
}: {
  method?: PaymentMethod;
  methods?: ReadonlyArray<{ id: PaymentMethod; enabled: boolean }>;
  disabled?: boolean;
  onChange?: (method: PaymentMethod) => void;
}) => {
  const t = useTravelTranslation();
  const name = useId();
  return (
    <fieldset className={styles.methods}>
      <legend>{t('选择支付方式')}</legend>
      {choices.map(({ id, label, icon: Icon }) => {
        const available = methods.some((x) => x.id === id && x.enabled);
        return (
          <label key={id}>
            <input
              checked={method === id}
              disabled={!available || disabled}
              name={name}
              type="radio"
              value={id}
              onChange={() => onChange?.(id)}
            />
            <Icon aria-hidden style={{ fontSize: 24 }} />
            <span style={{ flex: 1 }}>{t(label)}</span>
            {!available && <Text type="secondary">{t('暂未开通')}</Text>}
          </label>
        );
      })}
    </fieldset>
  );
};

export const PaymentCheckout = ({ quantity, initialOrder, onChanged }: Props) => {
  const t = useTravelTranslation();
  const config = lambdaQuery.platformCreditPurchase.checkoutConfig.useQuery(undefined, {
    retry: false,
  });
  const create = lambdaQuery.platformCreditPurchase.createCheckout.useMutation();
  const resume = lambdaQuery.platformCreditPurchase.resumeCheckout.useMutation();
  const utils = lambdaQuery.useUtils();
  const [order, setOrder] = useState(initialOrder);
  const [method, setMethod] = useState<PaymentMethod | undefined>(
    () => choices.find((x) => initialOrder?.productId.endsWith(`-${x.id}`))?.id,
  );
  const [payment, setPayment] = useState<PaymentInstruction | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const requestKey = useSingleton(() => crypto.randomUUID());
  const inFlight = useRef(false);
  const notified = useRef(false);
  const status = lambdaQuery.platformCreditPurchase.checkoutStatus.useQuery(
    { orderId: order?.id ?? '' },
    {
      enabled: !!order,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => {
        const current = query.state.data;
        return current &&
          (terminal.has(current.status) ||
            Date.now() - new Date(current.createdAt).getTime() >= 30 * 60_000)
          ? false
          : 3000;
      },
    },
  );
  const current = status.data ?? order;
  const amount =
    current?.amountMinor ??
    (config.data?.unitAmountMinor ? config.data.unitAmountMinor * quantity : undefined);
  const complete = current?.status === 'credited';
  const expired =
    current &&
    !terminal.has(current.status) &&
    Date.now() - new Date(current.createdAt).getTime() >= 30 * 60_000;
  const stopped = !!current && (terminal.has(current.status) || expired);
  const enabled = config.data?.methods.some((x) => x.id === method && x.enabled);
  useEffect(() => {
    if (complete && !notified.current) {
      notified.current = true;
      void utils.customerCenter.invalidate();
      void utils.platformCredit.invalidate();
      onChanged();
    }
  }, [complete, onChanged, utils]);

  const pay = async () => {
    if (!method || !amount || !enabled || inFlight.current || stopped) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    setAttempted(true);
    try {
      const result = order
        ? await resume.mutateAsync({ orderId: order.id })
        : await create.mutateAsync({
            method,
            quantity,
            expectedAmountMinor: amount,
            idempotencyKey: requestKey,
          });
      setOrder(result.order);
      setPayment(result.payment);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Flexbox gap={24} style={{ minWidth: 0 }}>
      <Flexbox gap={8}>
        <Text>{t('应付金额')}</Text>
        <Text fontSize={32} style={{ fontVariantNumeric: 'tabular-nums' }} weight={600}>
          {amount ? cny(amount) : '—'}
        </Text>
        <Text type="secondary">
          {new Intl.NumberFormat('zh-CN').format(current?.credits ?? quantity * 1_000_000)}{' '}
          {t('积分')}
        </Text>
        <Text type="secondary">{t('人民币收款，到账积分以本订单为准。')}</Text>
      </Flexbox>
      {config.isLoading ? (
        <SkeletonText rows={3} />
      ) : (
        <>
          <PaymentMethods
            method={method}
            methods={config.data?.methods}
            disabled={busy || attempted || !!order}
            onChange={setMethod}
          />
          {config.isError && (
            <Alert
              action={<Button onClick={() => void config.refetch()}>{t('重试')}</Button>}
              title={t('支付方式读取失败，请重试。')}
              type="error"
            />
          )}
          {!config.isError && !config.data?.methods.some((x) => x.enabled) && (
            <Alert showIcon title={t('支付通道暂未开通，当前不会扣款。')} type="warning" />
          )}
        </>
      )}
      {error && (
        <Alert showIcon title={t('支付发起失败，请重试或到订单列表继续支付。')} type="error" />
      )}
      {status.isError && (
        <Alert
          action={<Button onClick={() => void status.refetch()}>{t('查询付款状态')}</Button>}
          title={t('付款状态暂时无法读取，请刷新查询；不要重复付款。')}
          type="warning"
        />
      )}
      {complete ? (
        <Alert showIcon title={t('充值已到账')} type="success" />
      ) : current?.status === 'review_required' ? (
        <Alert title={t('付款信息待人工核对，请勿重复付款。')} type="warning" />
      ) : current?.status === 'paid' ? (
        <Alert title={t('付款已确认，积分正在入账。')} type="info" />
      ) : expired ? (
        <Alert title={t('支付时限已过；如已付款，请刷新订单状态，勿重复支付。')} type="warning" />
      ) : (
        !stopped && (
          <>
            {payment?.type === 'qr' && (
              <Flexbox align="center" gap={12}>
                <QRCode bgColor="#fff" color="#000" size={200} value={payment.codeUrl} />
                <Text>{t('请使用微信扫描二维码支付')}</Text>
              </Flexbox>
            )}
            {payment?.type === 'form' &&
              [
                'https://openapi.alipay.com/gateway.do?charset=utf-8',
                'https://gateway.95516.com/gateway/api/frontTransReq.do',
              ].includes(payment.action) && (
                <form
                  acceptCharset="UTF-8"
                  action={payment.action}
                  method="post"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {Object.entries(payment.fields).map(([name, value]) => (
                    <input key={name} name={name} type="hidden" value={value} />
                  ))}
                  <Button block htmlType="submit" type="primary">
                    {t('前往支付平台')}
                  </Button>
                </form>
              )}
            {!payment && (
              <Button
                block
                disabled={!enabled || !amount || busy}
                loading={busy}
                type="primary"
                onClick={() => void pay()}
              >
                {t(order ? '继续支付' : '确认充值')}
              </Button>
            )}
            {order && <Button onClick={() => void status.refetch()}>{t('查询付款状态')}</Button>}
          </>
        )
      )}
    </Flexbox>
  );
};

export const openPaymentCheckout = (props: Props) =>
  createModal({
    title: translateTravel('充值收银台'),
    content: <PaymentCheckout {...props} />,
    footer: null,
    width: 'min(560px, calc(100vw - 32px))',
    styles: { content: { maxHeight: '75vh', overflowY: 'auto' } },
  });
