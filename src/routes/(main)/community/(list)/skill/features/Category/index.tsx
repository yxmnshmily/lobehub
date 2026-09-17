'use client';

import { Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import qs from 'query-string';
import { memo } from 'react';

import { withSuspense } from '@/components/withSuspense';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useQuery } from '@/hooks/useQuery';
import { useSkillCategory } from '@/hooks/useSkillCategory';
import { SCROLL_PARENT_ID } from '@/routes/(main)/community/features/const';
import { useDiscoverStore } from '@/store/discover';
import { SkillCategory, SkillSorts } from '@/types/discover';

import CategoryMenu from '../../../../components/CategoryMenu';

/**
 * 单个分类的真实数量徽章：向技能列表接口发 pageSize=1 的轻量请求，只取
 * totalCount——与点击该分类后实际看到的分页完全同源。
 */
const CategoryCountBadge = memo<{ categoryKey: SkillCategory }>(({ categoryKey }) => {
  const useFetchSkillList = useDiscoverStore((s) => s.useFetchSkillList);
  const isAll = categoryKey === SkillCategory.All;
  const { data } = useFetchSkillList({
    category: isAll ? undefined : categoryKey,
    page: 1,
    pageSize: 1,
    ...(isAll ? { sort: SkillSorts.InstallCount } : {}),
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

CategoryCountBadge.displayName = 'SkillCategoryCountBadge';

const Category = memo(() => {
  const { category = SkillCategory.All, q } = useQuery() as {
    category?: SkillCategory;
    q?: string;
  };
  const navigate = useWorkspaceAwareNavigate();
  const cates = useSkillCategory();

  const genUrl = (key: SkillCategory) =>
    qs.stringifyUrl(
      {
        query: {
          category: key === SkillCategory.All ? null : key,
          q,
          sort: key === SkillCategory.All ? SkillSorts.InstallCount : null,
        },
        url: '/community/skill',
      },
      { skipNull: true },
    );

  const handleClick = (key: SkillCategory) => {
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
      onClick={(v) => handleClick(v.key as SkillCategory)}
    />
  );
});

export default withSuspense(Category);
