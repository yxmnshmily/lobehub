import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaQuery } from '@/libs/trpc/client';
import {
  displayMoney,
  INITIAL_EXCHANGE_RATE,
  isFreshExchangeRate,
  nextExchangeMonthAt,
} from '@/utils/currencyDisplay';

export function useMonthlyExchangeRate(refresh = false) {
  const { i18n } = useTranslation();
  const language = i18n.language || i18n.resolvedLanguage || 'en-US';
  const query = lambdaQuery.customerCenter.getDisplayExchangeRate.useQuery(undefined, {
    staleTime: (cached) =>
      cached.state.data && isFreshExchangeRate(cached.state.data) ? Infinity : 0,
    refetchInterval: false,
    retry: false,
  });
  const quote = query.data ?? INITIAL_EXCHANGE_RATE;
  const { refetch } = query;
  useEffect(() => {
    if (!refresh) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Local clock checks do not send requests; only the month boundary (or a failed update) does.
      const delay = isFreshExchangeRate(quote)
        ? Math.min(nextExchangeMonthAt() - Date.now(), 86_400_000)
        : 60 * 60 * 1000;
      timer = setTimeout(
        () => {
          if (!isFreshExchangeRate(quote)) void refetch();
          schedule();
        },
        Math.max(1, delay),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [refresh, quote, refetch]);
  const stale = query.isError || !isFreshExchangeRate(quote);
  const isCny = /^zh(?:-|$)/i.test(language);
  const money = useCallback(
    (amount: number | null | undefined, source = 'USD', digits = 2) =>
      displayMoney(amount, source, language, quote.rate, digits),
    [language, quote.rate],
  );
  const format = useCallback(
    (usd: number | null | undefined, digits = 2) =>
      displayMoney(usd, 'USD', language, quote.rate, digits),
    [language, quote.rate],
  );
  const formatOptional = useCallback(
    (usd: number | null | undefined) =>
      usd == null || !Number.isFinite(usd) || usd < 0
        ? null
        : format(usd, usd > 0 && usd < 0.01 ? 6 : 2),
    [format],
  );
  return {
    quote,
    stale,
    isCny,
    symbol: isCny ? '¥' : '$',
    convert: (usd: number) => (isCny ? (quote.rate > 0 ? usd * quote.rate : NaN) : usd),
    toUsd: (displayAmount: number) =>
      isCny ? (quote.rate > 0 ? displayAmount / quote.rate : NaN) : displayAmount,
    money,
    format,
    formatOptional,
    notice: !quote.updatedAt
      ? isCny
        ? '汇率暂不可用，跨币种金额暂不显示。'
        : 'Exchange rate unavailable; converted amounts are hidden.'
      : isCny
        ? `月度参考汇率 · 1 USD ≈ ${quote.rate} CNY · 报价日期 ${quote.rateDate} · 获取时间 ${quote.updatedAt} · 每月1日更新（北京时间），月内固定${stale ? '；更新未完成，以下金额沿用上月报价' : ''}；历史扣费不变`
        : `USD amounts · 1 USD ≈ ${quote.rate} CNY · Rate date: ${quote.rateDate} · Fetched: ${quote.updatedAt} · Updated on the 1st of each month (Beijing time), fixed within the month${stale ? '; refresh incomplete, displaying the previous month’s quote' : ''}. Historical charges are unchanged.`,
  };
}

/** One refresh timer for the app; all amount components share the query cache. */
export function MonthlyExchangeRateRefresh() {
  useMonthlyExchangeRate(true);
  return null;
}
