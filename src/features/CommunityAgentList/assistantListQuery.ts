import { type AssistantQueryParams, AssistantSorts } from '@/types/discover';

/** Keep the list and category sidebar on the same SWR request. */
export const buildAssistantListQuery = (params: AssistantQueryParams): AssistantQueryParams => ({
  category: params.category,
  includeAgentGroup: true,
  /* 始终让列表接口带出分类计数：侧栏的计数与翻页列表保持同一口径。之前的
     计数走独立的 categories 接口，其统计（如 文案 19192）与列表实际可翻的
     条数（80）对不上——两个接口的过滤条件不一致。 */
  includeCategoryCounts: true,
  order: params.order,
  page: params.page,
  pageSize: 21,
  q: params.q,
  sort: params.sort ?? AssistantSorts.Recommended,
  source: params.source,
});
