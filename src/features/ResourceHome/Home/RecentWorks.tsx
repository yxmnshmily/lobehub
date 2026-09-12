'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import {
  RESOURCE_HOME_SECTIONS,
  ResourceSectionSkeleton,
} from '@/components/Skeleton/ResourceHome';
import { useWorkspaceWorksInfinite } from '@/features/WorkGallery/hooks';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';
import WorkPreviewCard from '@/features/WorkGallery/WorkPreviewCard';

import SectionTitle from './SectionTitle';

const styles = createStaticStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    align-items: start;
  `,
}));

/** The dashboard shows only the freshest works; the full gallery lives at /resource/works. */
const MAX_RECENT_WORKS = 3;

/**
 * 首页「产物」只展示文档类作品。目标/任务（task）与其他来源（external/file）
 * 会以进度卡片的形式混进来，和文档并列既误导阅读，也不是这里的交付物，
 * 因此固定按 document 类型查询；完整列表仍在 /resource/works。
 */
const RECENT_WORKS_GALLERY_KEY = 'document' as const;

const RecentWorks = memo(() => {
  const { t } = useTranslation('file');
  const openWork = useOpenWork();

  const { error, items, isLoadingInitial, reload } =
    useWorkspaceWorksInfinite(RECENT_WORKS_GALLERY_KEY);
  const recent = items.slice(0, MAX_RECENT_WORKS);

  if (!isLoadingInitial && !error && recent.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <SectionTitle title={t('tab.other')} viewAllUrl={'/resource/works'} />
      {error && recent.length === 0 ? (
        <AsyncError error={error} variant={'inline'} onRetry={reload} />
      ) : isLoadingInitial ? (
        <ResourceSectionSkeleton {...RESOURCE_HOME_SECTIONS.works} />
      ) : (
        <div className={styles.grid}>
          {recent.map((item) => (
            <WorkPreviewCard
              item={item}
              key={item.id}
              onOpen={openWork}
              onDeleted={() => {
                void reload().catch(console.error);
              }}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
});

RecentWorks.displayName = 'RecentWorks';

export default RecentWorks;
