import { describe, expect, it } from 'vitest';

import { AssistantSorts } from '@/types/discover';

import { buildAssistantListQuery } from './assistantListQuery';

describe('buildAssistantListQuery', () => {
  it('should request the mixed list and category counts with one shared query', () => {
    expect(buildAssistantListQuery({ page: 2, q: 'pptx' })).toEqual({
      category: undefined,
      includeAgentGroup: true,
      includeCategoryCounts: true,
      order: undefined,
      page: 2,
      pageSize: 21,
      q: 'pptx',
      sort: AssistantSorts.Recommended,
      source: undefined,
    });
  });

  it('should preserve the browse path when there is no keyword search', () => {
    // 计数始终随列表返回：侧栏数字与翻页列表保持同一过滤口径。
    expect(buildAssistantListQuery({})).toEqual({
      category: undefined,
      includeAgentGroup: true,
      includeCategoryCounts: true,
      order: undefined,
      page: undefined,
      pageSize: 21,
      q: undefined,
      sort: AssistantSorts.Recommended,
      source: undefined,
    });
  });
});
