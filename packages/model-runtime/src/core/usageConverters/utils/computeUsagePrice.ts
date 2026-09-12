import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';

const decimalFraction = (value: number): [bigint, bigint] => {
  const [coefficient, exponent = '0'] = value.toString().split('e');
  const [integer, fraction = ''] = coefficient.split('.');
  const numerator = BigInt(integer + fraction);
  const scale = fraction.length - Number(exponent);
  return scale >= 0 ? [numerator, 10n ** BigInt(scale)] : [numerator * 10n ** BigInt(-scale), 1n];
};

/** Multiply decimal prices and usage before rounding once, without binary float overcharges. */
export const computeUsagePrice = (
  rate: number,
  quantity: number,
  unitScale = 1,
  currencyPerUsd = 1,
): { totalCost: number; totalCredits: number } | undefined => {
  if (![rate, quantity, unitScale, currencyPerUsd].every(Number.isFinite)) return undefined;
  if (rate < 0 || quantity < 0 || unitScale <= 0 || currencyPerUsd <= 0) return undefined;
  const [rateN, rateD] = decimalFraction(rate);
  const [quantityN, quantityD] = decimalFraction(quantity);
  const [scaleN, scaleD] = decimalFraction(unitScale);
  const [currencyN, currencyD] = decimalFraction(currencyPerUsd);
  const numerator = rateN * quantityN * scaleD * currencyD;
  const denominator = rateD * quantityD * scaleN * currencyN;
  const creditNumerator = numerator * BigInt(CREDITS_PER_DOLLAR);
  const totalCredits = Number((creditNumerator + denominator - 1n) / denominator);
  if (!Number.isSafeInteger(totalCredits)) return undefined;
  const totalCost = Number(numerator) / Number(denominator);
  if (!Number.isFinite(totalCost) || (totalCost === 0 && totalCredits > 0)) return undefined;
  return { totalCost, totalCredits };
};
