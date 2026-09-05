export type CustomerCenterSectionKey =
  'account-security' | 'balance-usage' | 'recharge-history' | 'my-creations';

export const CUSTOMER_CENTER_SECTIONS: readonly CustomerCenterSectionKey[] = [
  'account-security',
  'balance-usage',
  'recharge-history',
  'my-creations',
];

export const resolveCustomerCenterSection = (
  section: null | string,
): CustomerCenterSectionKey | undefined =>
  CUSTOMER_CENTER_SECTIONS.includes(section as CustomerCenterSectionKey)
    ? (section as CustomerCenterSectionKey)
    : undefined;

export interface CustomerCenterDataState<T> {
  data?: T;
  error?: string;
  isLoading?: boolean;
  isUnavailable?: boolean;
}

export interface CustomerCenterPaginationControl {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading?: boolean;
  onBack: () => void;
  onForward: () => void;
}

export interface CustomerCenterPagination {
  generationTasks?: CustomerCenterPaginationControl;
  orders?: CustomerCenterPaginationControl;
  recharges?: CustomerCenterPaginationControl;
  works?: CustomerCenterPaginationControl;
}

export interface CustomerBalances {
  /** Integer LobeHub Credits. One USD equals 1,000,000 Credits. */
  creditBalance?: number | null;
}

export interface CustomerUsageSummary {
  /** Runtime-reported USD cost. The customer center never derives this value. */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type CustomerCreditEntryKind = 'adjustment' | 'reversal' | 'top_up' | 'usage_charge';

export interface CustomerRechargeRecord {
  /** Integer Credits added to or removed from the account. */
  creditDelta: number;
  id: string;
  kind: CustomerCreditEntryKind;
  occurredAt: Date | string;
}

export interface CustomerServiceOrder {
  amountFen: number;
  id: string;
  occurredAt: Date | string;
  status: 'cancelled' | 'completed' | 'pending' | 'refunded';
  title: string;
}

export type CustomerCreationStatus = 'failed' | 'processing' | 'succeeded' | string;
export type CustomerCreationStatusKey =
  'failed' | 'processing' | 'succeeded' | 'unavailable' | 'unknown';

export type CustomerGenerationType = 'copy' | 'document' | 'image' | 'video';
export type CustomerGenerationStatusFilter = 'failed' | 'processing' | 'succeeded' | 'unavailable';

export interface CustomerGenerationFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: CustomerGenerationStatusFilter;
  type?: CustomerGenerationType;
}

export interface CustomerGenerationArtifact {
  content?: string;
  href?: string;
  id?: string;
  mimeType?: string;
  name?: string;
  type: 'document' | 'image' | 'text' | 'video';
  url?: string;
}

export interface CustomerGenerationDetail {
  artifacts: CustomerGenerationArtifact[];
  createdAt: Date | string;
  id: string;
  isVideoUnavailable: boolean;
  settlementStatus: 'not_applicable' | 'pending' | 'settled';
  status: CustomerCreationStatus;
  type: CustomerGenerationType;
  updatedAt: Date | string;
}

export interface CustomerGenerationTask {
  createdAt?: Date | string;
  id: string;
  status: CustomerCreationStatus;
  title: null | string;
  type: string;
  updatedAt: Date | string;
}

export interface CustomerWork {
  href?: string;
  id: string;
  title?: null | string;
  type?: null | string;
  updatedAt: Date | string;
}

export interface CustomerCreations {
  generationTasks: CustomerGenerationTask[];
  works: CustomerWork[];
}

export interface CustomerCenterData {
  balances: CustomerCenterDataState<CustomerBalances>;
  creations: CustomerCenterDataState<CustomerCreations>;
  orders: CustomerCenterDataState<CustomerServiceOrder[]>;
  recharges: CustomerCenterDataState<CustomerRechargeRecord[]>;
  usage: CustomerCenterDataState<CustomerUsageSummary>;
}

export interface CustomerCenterCopy {
  accountSecurityTitle: string;
  balancesTitle: string;
  balanceUnavailable: string;
  creationStatus: Record<CustomerCreationStatusKey, string>;
  creationsUnavailable: string;
  creditBalanceLabel: string;
  creditsChangeLabel: string;
  /** @deprecated Usage charges belong in the Credits ledger, not truncated usage aggregates. */
  creditsConsumedLabel?: string;
  defaultRechargeSource: string;
  generationSettlementPending?: string;
  generationTasksEmpty: string;
  generationTasksTitle: string;
  generationUnavailableVideo?: string;
  inputTokensLabel: string;
  ledgerEntryType?: Partial<Record<CustomerCreditEntryKind, string>>;
  ordersEmpty?: string;
  orderStatus?: Partial<Record<CustomerServiceOrder['status'], string>>;
  ordersTitle?: string;
  outputTokensLabel: string;
  pageNextLabel?: string;
  pagePreviousLabel?: string;
  /** @deprecated Provider details are not rendered in the customer center. */
  providerLabel?: string;
  rechargeEmpty: string;
  rechargeTitle: string;
  /** @deprecated Runtime pricing details are not rendered in the customer center. */
  runtimeCostUsdLabel?: string;
  sections: Record<CustomerCenterSectionKey, string>;
  sessionSecurityNotice?: string;
  /** @deprecated Use translated section copy; the customer center does not render this text. */
  subtitle?: string;
  title: string;
  totalTokensLabel: string;
  usageEmpty: string;
  usageSummaryTitle?: string;
  /** @deprecated Use usageSummaryTitle for customer-safe aggregate usage copy. */
  usageTitle?: string;
  worksEmpty: string;
  worksTitle: string;
}

export const resolveTotalTokenCount = ({
  inputTokens,
  outputTokens,
  totalTokens,
}: CustomerUsageSummary): number | undefined => {
  if (totalTokens !== undefined) {
    return Number.isSafeInteger(totalTokens) && totalTokens >= 0 ? totalTokens : undefined;
  }
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const sum = inputTokens + outputTokens;
  return Number.isSafeInteger(sum) && sum >= 0 ? sum : undefined;
};

const formatInteger = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

export const formatCredits = (value: number | null | undefined, locale: string): string =>
  value === undefined || value === null || !Number.isSafeInteger(value) || value < 0
    ? '—'
    : formatInteger(value, locale);

export const formatSignedCredits = (value: number, locale: string): string =>
  Number.isSafeInteger(value) ? `${value > 0 ? '+' : ''}${formatInteger(value, locale)}` : '—';

export const formatTokenCount = (value: number | null | undefined, locale: string): string =>
  value === undefined || value === null || !Number.isSafeInteger(value) || value < 0
    ? '—'
    : formatInteger(value, locale);

export const formatCustomerDateTime = (value: Date | string, locale: string): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

export const getCreationStatusKey = (status: CustomerCreationStatus): CustomerCreationStatusKey => {
  if (status === 'processing' || status === 'succeeded' || status === 'failed') return status;
  if (status === 'unavailable') return status;
  return 'unknown';
};
