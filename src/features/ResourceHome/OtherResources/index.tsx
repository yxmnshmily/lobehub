'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { SWRConfig } from 'swr';

import AsyncError from '@/components/AsyncError';
import NavHeader from '@/features/NavHeader';
import { useResourceManagerUrlSync } from '@/features/ResourceManager/hooks/useResourceManagerUrlSync';
import { useWorkspaceWorksInfinite } from '@/features/WorkGallery/hooks';
import { WorkGalleryCardsSkeleton } from '@/features/WorkGallery/Skeleton';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';
import WorkPreviewCard from '@/features/WorkGallery/WorkPreviewCard';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow-y: auto;
    min-height: 0;
    padding: 24px;

    @media (width <= 767px) {
      padding-inline: var(--mobile-page-inner-gutter, var(--mobile-page-gutter, 10px));
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: 16px;
    align-items: start;
  `,
}));

/**
 * 「其他」这一页装的是 agent 产出的作品（Work），不是上传的文件：整页按作品展示，
 * 与资源首页「其他」栏同一份数据（useWorkspaceWorksInfinite('document')）与同一种
 * 卡片（WorkPreviewCard），并按需要「加载更多」。
 */
function OtherResourcesContent() {
  const { t } = useTranslation(['file', 'common']);
  const openWork = useOpenWork();
  useFetchAgentList();
  useResourceManagerUrlSync();

  const { error, hasMore, isLoadingInitial, isLoadingMore, isValidating, items, loadMore, reload } =
    useWorkspaceWorksInfinite('document');

  return (
    <Flexbox height="100%" style={{ minHeight: 0 }}>
      <NavHeader />
      <Flexbox className={styles.content} flex={1} gap={16}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('tab.other')}</h2>
        {error && <AsyncError error={error} variant="inline" onRetry={() => void reload()} />}
        {isLoadingInitial && items.length === 0 && !error ? (
          <WorkGalleryCardsSkeleton />
        ) : (
          <div className={styles.grid}>
            {items.map((item) => (
              <WorkPreviewCard
                item={item}
                key={item.id}
                onDeleted={() => void reload()}
                onOpen={openWork}
              />
            ))}
          </div>
        )}
        {!isLoadingInitial && !error && items.length === 0 && <span>{t('empty')}</span>}
        {!error && hasMore && (
          <Button loading={isLoadingMore || isValidating} onClick={loadMore}>
            {t('loadMore')}
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
}

export default function OtherResources() {
  // This feed handles its own errors locally; an inherited suspense boundary would
  // discard successfully loaded cards when a later page fails.
  return (
    <SWRConfig value={{ suspense: false, shouldRetryOnError: false }}>
      <OtherResourcesContent />
    </SWRConfig>
  );
}
