'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import AddButton from '@/features/ResourceManager/components/Header/AddButton';
import { KnowledgeBaseListProvider } from '@/features/ResourceManager/components/KnowledgeBaseListProvider';

import Libraries from './Libraries';
import RecentFiles from './RecentFiles';
import RecentWorks from './RecentWorks';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding-block: 32px 64px;
    padding-inline: 32px;

    > * {
      width: 100%;
      min-width: 0;
    }

    @media (width <= 767px) {
      padding-block: 16px 48px;
      padding-inline: var(--mobile-page-inner-gutter, var(--mobile-page-gutter, 10px));
    }
  `,
  scroll: css`
    overflow: hidden auto;
    flex: 1;
  `,
}));

/**
 * The library-style landing page of /resource: libraries (once — the sidebar
 * holds the full index), then recent files → works, instead of the flat
 * all-files table (which now lives at /resource/all).
 */
const ResourceHomeDashboard = memo(() => {
  const { t } = useTranslation('file');

  return (
    <KnowledgeBaseListProvider>
      <Flexbox height={'100%'}>
        {/* 头部与下面内容留 8px 间距（对应页面修改器里 /resource 与 /resource/images 的 8px） */}
        <div style={{ marginBottom: 8 }}>
          <NavHeader
            left={<Flexbox style={{ marginLeft: 8 }}>{t('resource')}</Flexbox>}
            right={<AddButton />}
            style={{ borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}` }}
          />
        </div>
        <div className={styles.scroll}>
          <Flexbox className={styles.content} gap={40}>
            <Libraries />
            <RecentFiles />
            <RecentWorks />
          </Flexbox>
        </div>
      </Flexbox>
    </KnowledgeBaseListProvider>
  );
});

ResourceHomeDashboard.displayName = 'ResourceHomeDashboard';

export default ResourceHomeDashboard;
