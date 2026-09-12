// Approved retail price: CNY 10 per million credits, independent of API cost accounting.
export const CREDIT_PURCHASE_UNIT = {
  amountMinor: 1000,
  credits: 1_000_000,
  currency: 'CNY',
} as const;
export const CREDIT_PURCHASE_QUANTITIES = [1, 10, 20, 50, 100, 500] as const;
export const CREDIT_PURCHASE_MAX_QUANTITY = 500;
