'use client';

import { Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import qs from 'query-string';
import { memo } from 'react';

import { withSuspense } from '@/components/withSuspense';
import { buildAssistantListQuery } from '@/features/CommunityAgentList/assistantListQuery';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { useDiscoverStore } from '@/store/discover';
import { AssistantCategory, type AssistantQueryParams, AssistantSorts } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';
import { useCategory } from './useCategory';

/**
 * 单个分类的真实数量徽章：向列表接口发一个 pageSize=1 的轻量请求，只取
 * totalCount——与实际翻页列表完全同源（点击该分类看到的分页就是这个数字）。
 * 不使用独立的 categories 计数接口：它统计上游社区全量（文案 19192），与本
 * 平台列表（80）对不上。SWR 会按参数缓存，重复渲染不重复请求。
 */
const CategoryCountBadge = memo<{ categoryKey: AssistantCategory }>(({ categoryKey }) => {
  const useAssistantList = useDiscoverStore((s) => s.useAssistantList);
  /* 全部 = 不带 category 参数（未过滤全量）；发现 = 推荐流；其余 = 各分类。
     与点击该分类后实际看到的列表查询保持同一口径。 */
  const isDiscover = categoryKey === AssistantCategory.Discover;
  const isAll = categoryKey === AssistantCategory.All;
  const params: AssistantQueryParams = isAll
    ? { page: 1, pageSize: 1 }
    : isDiscover
      ? { page: 1, pageSize: 1, sort: AssistantSorts.Recommended }
      : { ...buildAssistantListQuery({ category: categoryKey }), page: 1, pageSize: 1 };
  const { data } = useAssistantList(params, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const count = data?.totalCount;
  /* 请求未返回（undefined）时不显示；后端明确返回 0 时如实显示 0。 */
  if (count === undefined) return null;

  return (
    <Tag
      size={'small'}
      style={{
        borderRadius: 12,
        paddingInline: 6,
      }}
    >
      {count}
    </Tag>
  );
});

CategoryCountBadge.displayName = 'CategoryCountBadge';

const Category = memo(() => {
  const query = useQuery() as AssistantQueryParams;
  const { category = AssistantCategory.Discover } = query;
  const navigate = useWorkspaceAwareNavigate();
  const cates = useCategory();

  const genUrl = (key: AssistantCategory) =>
    qs.stringifyUrl(
      {
        query: {
          category: key === AssistantCategory.Discover ? null : key,
          q: query.q,
          sort: key === AssistantCategory.Discover ? AssistantSorts.Recommended : null,
        },
        url: '/community/agent',
      },
      { skipNull: true },
    );

  const handleClick = (key: AssistantCategory) => {
    navigate(genUrl(key));
    const scrollableElement = document?.querySelector(`#${SCROLL_PARENT_ID}`);
    if (!scrollableElement) return;
    scrollableElement.scrollTo({ behavior: 'smooth', top: 0 });
  };

  return (
    <CategoryMenu
      mode={'inline'}
      selectedKeys={[category]}
      items={cates.map((item) => ({
        ...item,
        icon: <Icon icon={item.icon} size={18} />,
        label: <WorkspaceLink to={genUrl(item.key)}>{item.label}</WorkspaceLink>,
        extra: <CategoryCountBadge categoryKey={item.key} />,
      }))}
      onClick={(v) => handleClick(v.key as AssistantCategory)}
    />
  );
});

export default withSuspense(Category);
