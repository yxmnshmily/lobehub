'use client';

import { Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import qs from 'query-string';
import { memo } from 'react';

import { withSuspense } from '@/components/withSuspense';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { useDiscoverStore } from '@/store/discover';

import CategoryMenu from '../../../../components/CategoryMenu';
import { useCategory } from './useCategory';

/**
 * 单个分类的真实数量徽章：向模型列表接口发 pageSize=1 的轻量请求，只取
 * totalCount——与点击该分类后实际看到的分页完全同源。
 */
const CategoryCountBadge = memo<{ categoryKey: string }>(({ categoryKey }) => {
  const useModelList = useDiscoverStore((s) => s.useModelList);
  const isAll = categoryKey === 'all';
  const { data } = useModelList({
    category: isAll ? undefined : categoryKey,
    page: 1,
    pageSize: 1,
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

CategoryCountBadge.displayName = 'ModelCategoryCountBadge';

const Category = memo(() => {
  const { category = 'all', q } = useQuery() as { category?: string; q?: string };
  const navigate = useWorkspaceAwareNavigate();
  const cates = useCategory();

  const genUrl = (key: string) =>
    qs.stringifyUrl(
      {
        query: { category: key === 'all' ? null : key, q },
        url: '/community/model',
      },
      { skipNull: true },
    );

  const handleClick = (key: string) => {
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
      onClick={(v) => handleClick(v.key as string)}
    />
  );
});

export default withSuspense(Category);
