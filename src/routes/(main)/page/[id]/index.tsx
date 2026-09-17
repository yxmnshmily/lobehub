'use client';

import { useUnmount } from 'ahooks';
import { memo, Suspense, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { createStoreUpdater } from 'zustand-utils';

import { delayed } from '@/components/Skeleton/Delayed';
import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { PageEditor } from '@/features/PageEditor';
import PageExplorer from '@/features/PageExplorer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePageStore } from '@/store/page';
import { getIdFromIdentifier, standardizeIdentifier } from '@/utils/identifier';

const PagesPage = memo(() => {
  const storeUpdater = createStoreUpdater(usePageStore);
  const params = useParams<{ id: string }>();

  const [searchParams] = useSearchParams();
  const navigate = useWorkspaceAwareNavigate();
  const pageId = params.id === 'new' ? null : getIdFromIdentifier(params.id ?? '', 'docs');
  const visibility = searchParams.get('visibility') === 'public' ? 'public' : 'private';
  const handleCreated = useCallback(
    (id: string) => {
      navigate(`/page/${standardizeIdentifier(id)}`, { replace: true });
    },
    [navigate],
  );

  useUnmount(() => {
    usePageStore.setState({ selectedPageId: null });
  });

  storeUpdater('selectedPageId', pageId);

  return (
    <Suspense fallback={delayed(<SurfaceSkeleton variant={'editor'} />)}>
      {pageId ? (
        <PageExplorer pageId={pageId} />
      ) : (
        <PageEditor
          draftVisibility={visibility}
          key={visibility}
          onDocumentIdChange={handleCreated}
        />
      )}
    </Suspense>
  );
});

PagesPage.displayName = 'PagesPage';

export default PagesPage;
