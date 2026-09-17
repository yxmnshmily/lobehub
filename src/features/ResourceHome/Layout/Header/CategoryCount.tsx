import { cssVar } from 'antd-style';
import { useEffect } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  getResourceQueryVisibility,
  getResourceSourceFilter,
} from '@/features/ResourceManager/store/selectors';
import { lambdaQuery } from '@/libs/trpc/client';
import { useFileStore } from '@/store/file';
import { FilesTabs } from '@/types/files';

import { useOtherWorks } from '../../OtherResources/useOtherWorks';

function FileCategoryCount({ category }: { category: FilesTabs }) {
  const state = useResourceManagerStore();
  const resources = useFileStore((s) => s.resourceList);
  const resolvedCategory = category === FilesTabs.Home ? FilesTabs.All : category;
  const query = lambdaQuery.file.resolveKnowledgeItemIds.useQuery(
    {
      category: resolvedCategory,
      parentId: null,
      showFilesInKnowledgeBase: false,
      visibility: getResourceQueryVisibility(undefined, state.listVisibility),
      sourceFilter: getResourceSourceFilter({
        ...state,
        libraryId: undefined,
        category: resolvedCategory,
        sourceFilter: state.category === resolvedCategory ? state.sourceFilter : undefined,
      }),
    },
    { staleTime: 30000, refetchOnWindowFocus: true },
  );
  useEffect(() => {
    void query.refetch();
  }, [resources]);
  return query.data ? (
    <span style={{ color: cssVar.colorError }}>（{query.data.total}）</span>
  ) : null;
}

function WorkCategoryCount() {
  const { data } = useOtherWorks();
  return data == null ? null : <span style={{ color: cssVar.colorError }}>（{data.length}）</span>;
}

export default function CategoryCount({ category }: { category: FilesTabs }) {
  return category === FilesTabs.Other ? (
    <WorkCategoryCount />
  ) : (
    <FileCategoryCount category={category} />
  );
}
