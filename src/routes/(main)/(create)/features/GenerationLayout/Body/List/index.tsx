'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import NavSkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../../types';
import GridSkeletonList from './SkeletonList';
import { GenerationTopicStoreProvider } from './StoreContext';
import TopicList from './TopicList';

const List = memo<
  Pick<GenerationLayoutCommonProps, 'namespace' | 'useStore' | 'viewModeStatusKey'> & {
    visibility?: 'private' | 'public';
    /** 弹窗等场景强制视图形态（如 'list' = 缩略图+标题行），优先于全局偏好 */
    viewModeOverride?: 'grid' | 'list';
  }
>(({ namespace, useStore, viewModeStatusKey, visibility, viewModeOverride }) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const preferredViewMode = useGlobalStore((s) =>
    systemStatusSelectors.showLeftPanel(s) ? systemStatusSelectors[viewModeStatusKey](s) : 'list',
  );
  const viewMode = viewModeOverride ?? preferredViewMode;

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  const { data, isLoading } = useFetchGenerationTopics(!!isLogin) ?? {};

  if (isLogin && isLoading && !data) {
    return viewMode === 'list' ? <NavSkeletonList rows={3} /> : <GridSkeletonList />;
  }

  return (
    <GenerationTopicStoreProvider value={{ namespace, useStore: useStore as any }}>
      <Flexbox gap={4} paddingBlock={1}>
        <TopicList viewMode={viewMode} visibility={visibility} />
      </Flexbox>
    </GenerationTopicStoreProvider>
  );
});

export default List;
