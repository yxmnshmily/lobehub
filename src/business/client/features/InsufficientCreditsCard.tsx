'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { BatteryLow, ChevronRight, Coins, Layers } from 'lucide-react';
import { useRef, useState } from 'react';

import { CREDIT_PURCHASE_UNIT } from '@/const/creditPurchase';
import { openCreditDialog } from '@/features/ChatInput/SendArea/openCreditDialog';
import { getBudgetContextFromErrorBody } from '@/features/Conversation/Error/PlanLimitCard/budget';
import { getTravelLocale, useTravelTranslation } from '@/utils/i18n/travel';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    width: 100%;
    max-width: 480px;
    margin: 24px auto;
    padding: 16px;
    color: ${cssVar.colorText};
    box-sizing: border-box;
  `,
  heading: css`
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    text-align: center;
  `,
  description: css`
    margin: 0;
    color: ${cssVar.colorTextSecondary};
    font-size: 14px;
    line-height: 1.6;
    text-align: center;
    overflow-wrap: anywhere;
  `,
  option: css`
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    padding: 16px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};
    text-align: start;
    font: inherit;
    & > svg {
      flex-shrink: 0;
    }
    &:hover {
      border-color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillQuaternary};
    }
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  optionCopy: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 14px;
    overflow-wrap: anywhere;
    & > span {
      color: ${cssVar.colorTextSecondary};
      line-height: 1.5;
    }
  `,
}));

const validCredits = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export default function InsufficientCreditsCard({
  errorBody,
  groupOwner = false,
  onRetry,
}: {
  errorBody?: unknown;
  groupOwner?: boolean;
  onRetry?: () => Promise<void> | void;
}) {
  const t = useTravelTranslation();
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const inFlight = useRef(false);
  const budget = getBudgetContextFromErrorBody(errorBody);
  const locale = getTravelLocale();
  const shortfall = budget?.shortfallCredits;
  const format = (amount: number) => new Intl.NumberFormat(locale).format(amount);
  const price = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: CREDIT_PURCHASE_UNIT.currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(CREDIT_PURCHASE_UNIT.amountMinor / 100);
  const description = groupOwner
    ? t('本群 AI 请求由群主承担积分，请联系群主充值后再试。')
    : validCredits(shortfall)
      ? t(
          budget?.pricingBasis === 'estimated' || budget?.pricingBasis === 'approximate'
            ? '本次请求预计还差 {{credits}} 积分，充值到账后可重试。'
            : '本次请求还差 {{credits}} 积分，充值到账后即可重试。',
          { credits: format(shortfall) },
        )
      : t('可用积分不足以完成本次请求，请充值后重试。');
  const retry = async () => {
    if (!onRetry || inFlight.current) return;
    inFlight.current = true;
    setRetrying(true);
    setRetryFailed(false);
    try {
      await onRetry();
    } catch {
      setRetryFailed(true);
    } finally {
      inFlight.current = false;
      setRetrying(false);
    }
  };

  return (
    <section aria-label={t('积分不足提示')} className={styles.container}>
      <BatteryLow aria-hidden size={40} style={{ color: cssVar.colorWarning }} />
      <Flexbox gap={8}>
        <h3 className={styles.heading}>{t(groupOwner ? '群主积分不足' : '积分不够啦')}</h3>
        <p className={styles.description}>{description}</p>
        {validCredits(budget?.requiredCredits) && (
          <p className={styles.description}>
            {t('本次请求所需积分：{{credits}}', { credits: format(budget.requiredCredits) })}
          </p>
        )}
      </Flexbox>
      {!groupOwner && (
        <Flexbox gap={12} width="100%">
          <button
            className={styles.option}
            type="button"
            onClick={() => openCreditDialog('credits')}
          >
            <Coins aria-hidden size={24} />
            <span className={styles.optionCopy}>
              <strong>{t('购买积分')}</strong>
              <span>
                {t('每 {{credits}} 积分 {{price}}，按需充值', {
                  credits: format(CREDIT_PURCHASE_UNIT.credits),
                  price,
                })}
              </span>
            </span>
            <ChevronRight aria-hidden size={18} />
          </button>
          <button className={styles.option} type="button" onClick={() => openCreditDialog('plans')}>
            <Layers aria-hidden size={24} />
            <span className={styles.optionCopy}>
              <strong>{t('查看套餐')}</strong>
              <span>{t('了解各档月度额度，套餐支付暂未开通')}</span>
            </span>
            <ChevronRight aria-hidden size={18} />
          </button>
          <Button block size="large" type="primary" onClick={() => openCreditDialog('credits')}>
            {t('充值积分')}
          </Button>
        </Flexbox>
      )}
      {onRetry && (
        <Button block disabled={retrying} onClick={() => void retry()}>
          {t(retrying ? '正在重试…' : groupOwner ? '重新尝试' : '已充值，重试本次请求')}
        </Button>
      )}
      {retryFailed && (
        <p className={styles.description} role="alert">
          {t('重试未成功，请检查余额或稍后再试。')}
        </p>
      )}
    </section>
  );
}
