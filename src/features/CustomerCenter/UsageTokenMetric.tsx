import { formatLocalizedTokens } from '@lobechat/utils/format';
import type { Pricing } from 'model-bank';

import { getTravelLocale } from '@/utils/i18n/travel';

import { estimateTokenCredits } from './estimateCreditTokens';
import { useMonthlyExchangeRate } from './useMonthlyExchangeRate';

export default function UsageTokenMetric({
  tokens,
  input,
  output,
  pricing,
}: {
  tokens: number | null | undefined;
  input: number | null | undefined;
  output: number | null | undefined;
  pricing: Pricing | undefined;
}) {
  const locale = getTravelLocale();
  const { quote, stale } = useMonthlyExchangeRate();
  const zh = /^zh(?:-|$)/i.test(locale);
  // Incomplete historical totals must not silently use a different input/output scope.
  const credits =
    tokens != null && input != null && output != null && tokens === input + output
      ? estimateTokenCredits(input, output, pricing, stale ? undefined : quote.rate)
      : null;
  const format = (n: number) => n.toLocaleString(locale);
  const equivalent = !credits
    ? '—'
    : credits[0] === credits[1]
      ? format(credits[0])
      : `${format(credits[0])}–${format(credits[1])}`;
  return (
    <>
      <strong style={{ overflowWrap: 'anywhere' }}>
        <span>{tokens == null ? '—' : formatLocalizedTokens(tokens, locale)}</span> Token ≈{' '}
        <span>
          {equivalent} {zh ? '积分' : 'credits'}
        </span>
      </strong>
      <small>
        {zh
          ? '按所选模型价格折算，非实际扣费；数据或报价不足时显示 —。'
          : 'Equivalent at the selected model’s prices, not actual charges; — means data or pricing is unavailable.'}
      </small>
    </>
  );
}
