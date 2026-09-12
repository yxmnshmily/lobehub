/** USD/CNY reference fixed for one Beijing calendar month. */
export interface MonthlyExchangeRate {
  month: string;
  rate: number;
  rateDate: string;
  updatedAt: string | null;
}

export const INITIAL_EXCHANGE_RATE: MonthlyExchangeRate = {
  month: '',
  rate: 0,
  rateDate: '',
  updatedAt: null,
};

export const isFreshExchangeRate = (quote: MonthlyExchangeRate, now = new Date()) => {
  const fetchedAt = Date.parse(quote.updatedAt ?? '');
  const age = now.getTime() - fetchedAt;
  // Validate source freshness when acquired, not throughout the locked month.
  const rateAge = fetchedAt - Date.parse(quote.rateDate);
  return (
    Number.isFinite(quote.rate) &&
    quote.rate > 0 &&
    quote.rate < 100 &&
    age >= 0 &&
    quote.month === exchangeMonth(now) &&
    quote.month === exchangeMonth(new Date(fetchedAt)) &&
    rateAge >= 0 &&
    rateAge <= 7 * 86_400_000
  );
};

export const exchangeMonth = (now = new Date()) =>
  new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);

export const nextExchangeMonthAt = (now = new Date()) => {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth() + 1, 1) - 8 * 60 * 60 * 1000;
};

export const displayCny = (usd: number | undefined | null, rate: number, digits = 2) => {
  if (usd == null || !Number.isFinite(usd) || !Number.isFinite(rate) || rate <= 0) return '—';
  return new Intl.NumberFormat('en-US', {
    currency: 'CNY',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: 'currency',
  }).format(usd * rate);
};

export const displayMoney = (
  amount: number | undefined | null,
  source: string,
  language: string,
  rate: number,
  digits = 2,
) => {
  if (amount == null || !Number.isFinite(amount)) return '—';
  const currency = /^zh(?:-|$)/i.test(language) ? 'CNY' : 'USD';
  const supported = source === 'USD' || source === 'CNY';
  if (supported && source !== currency && (!Number.isFinite(rate) || rate <= 0)) return '—';
  const value =
    !supported || source === currency ? amount : source === 'USD' ? amount * rate : amount / rate;
  try {
    return new Intl.NumberFormat('en-US', {
      currency: supported ? currency : source,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: digits,
      minimumFractionDigits: Math.min(2, digits),
      style: 'currency',
    }).format(value);
  } catch {
    return '—';
  }
};
