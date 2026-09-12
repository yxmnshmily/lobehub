import { CREDITS_PER_DOLLAR } from '@lobechat/const/currency';

/** Shift decimal units before rounding; binary multiplication can turn 123 credits into 124. */
export const usdToCredits = (costUsd: number): number => {
  const [coefficient, exponent = '0'] = costUsd.toString().split('e');
  return Math.ceil(Number(`${coefficient}e${Number(exponent) + Math.log10(CREDITS_PER_DOLLAR)}`));
};
