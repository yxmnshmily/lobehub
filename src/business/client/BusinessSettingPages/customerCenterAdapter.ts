import type { inferRouterOutputs } from '@trpc/server';

import type {
  CustomerCenterData,
  CustomerCenterDataState,
  CustomerGenerationDetail,
  CustomerGenerationFilters,
  CustomerWork,
} from '@/features/CustomerCenter';
import type { LambdaRouter } from '@/server/routers/lambda';

type CustomerCenterOverview = inferRouterOutputs<LambdaRouter>['customerCenter']['getOverview'];
type CustomerGenerationDetailOutput =
  inferRouterOutputs<LambdaRouter>['customerCenter']['getGenerationDetail'];

const localDateBoundary = (value: string, endOfDay: boolean): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

export const buildCustomerGenerationFilterInput = (filters: CustomerGenerationFilters) => ({
  dateFrom: filters.dateFrom ? localDateBoundary(filters.dateFrom, false) : undefined,
  dateTo: filters.dateTo ? localDateBoundary(filters.dateTo, true) : undefined,
  status: filters.status,
  type: filters.type,
});

export const buildCustomerGenerationDetail = (
  detail?: CustomerGenerationDetailOutput,
  state: PageState = {},
): CustomerCenterDataState<CustomerGenerationDetail> => {
  if (state.error || state.isLoading) return state;
  if (!detail) return { isUnavailable: true };

  const isVideoUnavailable =
    detail.type === 'video' &&
    (detail.status === 'unavailable' || detail.code === 'CAPABILITY_UNAVAILABLE');
  const isSettled = detail.settlementStatus === 'settled';
  return {
    data: {
      artifacts:
        isVideoUnavailable || !isSettled
          ? []
          : detail.artifacts.map((artifact) => ({
              content: artifact.content,
              href:
                artifact.type === 'document' && artifact.documentId
                  ? buildOwnedDocumentHref(artifact.documentId)
                  : undefined,
              id: artifact.id,
              mimeType: artifact.mimeType,
              name: artifact.name,
              type: artifact.type,
              url: artifact.url,
            })),
      createdAt: detail.createdAt,
      id: detail.id,
      isVideoUnavailable,
      settlementStatus: detail.settlementStatus,
      status: detail.status,
      type: detail.type as CustomerGenerationDetail['type'],
      updatedAt: detail.updatedAt,
    },
  };
};

interface PageState {
  error?: string;
  isLoading?: boolean;
}

interface CustomerCenterPageDataInput {
  generation?: {
    items: Array<{
      id: string;
      status: string;
      title: null | string;
      type: string;
      updatedAt: Date | string;
    }>;
  };
  ledger?: {
    items: Array<{
      amountCredits: number;
      createdAt: Date | string;
      id: string;
      type: 'adjustment' | 'reversal' | 'top_up' | 'usage_charge';
      updatedAt: Date | string;
    }>;
  };
  order?: {
    items: Array<{
      amountFen: number;
      createdAt: Date | string;
      id: string;
      status: 'cancelled' | 'completed' | 'pending' | 'refunded';
      title: string;
    }>;
  };
  work?: {
    items: Array<{
      fileType?: string;
      id: string;
      resourceType?: string;
      source: 'document' | 'generation' | 'work';
      title: null | string;
      topicId?: string;
      type?: string;
      updatedAt: Date | string;
    }>;
  };
}

interface CustomerCenterPageStates {
  generation?: PageState;
  ledger?: PageState;
  order?: PageState;
  work?: PageState;
}

export const mergeCustomerCenterPageItems = <T extends { id: string; updatedAt: Date | string }>(
  pages: T[][],
): T[] => {
  const seenIds = new Set<string>();
  return pages
    .flat()
    .sort((left, right) => {
      const timeDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return timeDelta || right.id.localeCompare(left.id);
    })
    .filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });
};

const unresolvedPageState = (...states: Array<PageState | undefined>) => {
  const error = states.find((state) => state?.error)?.error;
  if (error) return { error };
  if (states.some((state) => state?.isLoading)) return { isLoading: true };
  return unavailable;
};

export const buildCustomerCenterPageData = (
  pages: CustomerCenterPageDataInput,
  states: CustomerCenterPageStates = {},
): Pick<CustomerCenterData, 'creations' | 'orders' | 'recharges'> => {
  const generationPage = pages.generation;
  const ledgerPage = pages.ledger;
  const orderPage = pages.order;
  const workPage = pages.work;

  const creations =
    generationPage && workPage
      ? {
          data: {
            generationTasks: generationPage.items.map((task) => ({
              createdAt: task.createdAt,
              id: task.id,
              status: generationTaskStatus(task.status),
              title: task.title,
              type: task.type,
              updatedAt: task.updatedAt,
            })),
            works: workPage.items.map((work) => ({
              href:
                work.source === 'document'
                  ? buildOwnedDocumentHref(work.id)
                  : work.source === 'generation'
                    ? buildOwnedGenerationHref(work.type, work.topicId)
                    : undefined,
              id: work.id,
              title: work.title,
              type: work.type || work.resourceType || work.fileType,
              updatedAt: work.updatedAt,
            })),
          },
        }
      : unresolvedPageState(states.generation, states.work);

  const recharges = ledgerPage
    ? {
        data: ledgerPage.items.map((entry) => ({
          creditDelta: entry.amountCredits,
          id: entry.id,
          kind: entry.type,
          occurredAt: entry.createdAt,
        })),
      }
    : unresolvedPageState(states.ledger);

  const orders = orderPage
    ? {
        data: orderPage.items.map((order) => ({
          amountFen: order.amountFen,
          id: order.id,
          occurredAt: order.createdAt,
          status: order.status,
          title: order.title,
        })),
      }
    : unresolvedPageState(states.order);

  return { creations, orders, recharges };
};

const knownNumber = (metric: { available: boolean; value: null | number }) =>
  metric.available && metric.value !== null && Number.isFinite(metric.value)
    ? metric.value
    : undefined;

const knownTokenCount = (metric: { available: boolean; value: null | number }) => {
  const value = knownNumber(metric);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};

const unavailable = { isUnavailable: true } as const;

const emptyState = (state: { error?: string; isLoading?: boolean }): CustomerCenterData => ({
  balances: state,
  creations: state,
  orders: state,
  recharges: state,
  usage: state,
});

const generationTaskStatus = (status: string): string =>
  status === 'pending' || status === 'queued' || status === 'running' ? 'processing' : status;

const OWNED_DOCUMENT_ID = /^[\w-]{1,128}$/;
const CUSTOMER_GENERATION_ID = /^[\w-]{1,255}$/;

export const buildOwnedDocumentHref = (documentId: string): string | undefined =>
  OWNED_DOCUMENT_ID.test(documentId) ? `/page/${encodeURIComponent(documentId)}` : undefined;

export const buildOwnedGenerationHref = (type?: string, topicId?: string): string | undefined =>
  (type === 'image' || type === 'video') && topicId && topicId.length <= 255
    ? `/${type}?topic=${encodeURIComponent(topicId)}`
    : undefined;

export const resolveCustomerGenerationDetailId = (value: null | string): string | undefined =>
  value && CUSTOMER_GENERATION_ID.test(value) ? value : undefined;

export const buildCustomerCenterData = (
  overview?: CustomerCenterOverview,
  state: { error?: string; isLoading?: boolean } = {},
): CustomerCenterData => {
  if (state.isLoading || state.error || !overview) return emptyState(state);

  const creations = overview.content.creations;
  const works: CustomerWork[] = [];

  if (creations) {
    const workIds = new Set<string>();
    for (const work of creations.recentWorks) {
      workIds.add(work.id);
      works.push({
        id: work.id,
        title: work.title,
        type: work.type || work.resourceType,
        updatedAt: work.updatedAt,
      });
    }
    for (const document of creations.recentDocuments) {
      if (workIds.has(document.id)) continue;
      works.push({
        href: buildOwnedDocumentHref(document.id),
        id: document.id,
        title: document.title,
        type: document.fileType,
        updatedAt: document.updatedAt,
      });
    }
  }

  const usage = overview.usage?.canonicalTotals;

  return {
    balances: overview.credits.account
      ? { data: { creditBalance: overview.credits.account.balanceCredits } }
      : unavailable,
    creations: creations
      ? {
          data: {
            generationTasks: creations.recentGenerationTasks.map((task) => ({
              createdAt: task.createdAt,
              id: task.id,
              status: generationTaskStatus(task.status),
              title: task.title,
              type: task.type,
              updatedAt: task.updatedAt,
            })),
            works,
          },
        }
      : unavailable,
    orders: unavailable,
    recharges: overview.credits.entries
      ? {
          data: overview.credits.entries.map((entry) => ({
            creditDelta: entry.amountCredits,
            id: entry.id,
            kind: entry.type,
            occurredAt: entry.createdAt,
          })),
        }
      : unavailable,
    usage: usage
      ? {
          data: {
            costUsd: knownNumber(usage.costUsd),
            inputTokens: knownTokenCount(usage.totalInputTokens),
            outputTokens: knownTokenCount(usage.totalOutputTokens),
            totalTokens: knownTokenCount(usage.totalTokens),
          },
        }
      : unavailable,
  };
};
