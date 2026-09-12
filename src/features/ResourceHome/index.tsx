'use client';

import { memo, useLayoutEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import ResourceManager from '@/features/ResourceManager';
import { KnowledgeBaseListProvider } from '@/features/ResourceManager/components/KnowledgeBaseListProvider';
import { useInitFileCheck } from '@/features/ResourceManager/hooks/useInitFileCheck';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { parseWorkGalleryKey } from '@/features/WorkGallery/const';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { FilesTabs } from '@/types/files';

import OtherResources from './OtherResources';

/**
 * Path segment → category for routes that own one: /resource/all,
 * /resource/page (derived pages/notes), /resource/documents, …
 */
export const CATEGORY_BY_SEGMENT: Record<string, FilesTabs> = {
  all: FilesTabs.All,
  audios: FilesTabs.Other,
  documents: FilesTabs.Documents,
  files: FilesTabs.Other,
  images: FilesTabs.Images,
  other: FilesTabs.Other,
  page: FilesTabs.Documents,
  videos: FilesTabs.Videos,
  websites: FilesTabs.Websites,
  works: FilesTabs.Other,
};

const SEGMENT_BY_CATEGORY: Partial<Record<FilesTabs, string>> = {
  [FilesTabs.All]: 'all',
  [FilesTabs.Documents]: 'documents',
  [FilesTabs.Pages]: 'documents',
  [FilesTabs.Audios]: 'other',
  [FilesTabs.Files]: 'other',
  [FilesTabs.Other]: 'other',
  [FilesTabs.Images]: 'images',
  [FilesTabs.Videos]: 'videos',
  [FilesTabs.Websites]: 'websites',
};

/** Canonical path for a category, e.g. /resource/page for Pages. */
export const resourceCategoryPath = (category: FilesTabs): string =>
  SEGMENT_BY_CATEGORY[category] ? `/resource/${SEGMENT_BY_CATEGORY[category]}` : '/resource';

export const resolveResourcePathCategory = (
  category: string | undefined,
  pathname: string,
): string | undefined => category ?? pathname.match(/\/resource\/([^/]+)\/?$/)?.[1];

/** Path segment of the cross-topic Work gallery: /resource/works */
export const WORKS_PATH_SEGMENT = 'works';

const ResourceHomePage = memo(() => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const params = useParams<{ category?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const [setCategory, setLibraryId] = useResourceManagerStore((s) => [
    s.setCategory,
    s.setLibraryId,
  ]);

  // Category-specific route metadata uses static sibling routes, so recover
  // their segment from the pathname when React Router has no :category param.
  const pathCategory = resolveResourcePathCategory(params.category, location.pathname);
  const segmentCategory = pathCategory ? CATEGORY_BY_SEGMENT[pathCategory] : undefined;
  const isValidPathCategory = segmentCategory !== undefined;
  // The Work gallery owns its own path segment; `?works=<key>` narrows it
  // (task / document / linear / github), defaulting to the combined view.
  const isWorksPath = pathCategory === WORKS_PATH_SEGMENT;
  // 裸 /resource 就是「全部」这一页本身（URL 不变，不做跳转）：打开文件管理直接看到
  // 资源列表，不再先落在一屏「库 / 最近文件 / 其他」的首页看板上。
  const categoryParam = segmentCategory ?? FilesTabs.All;

  // Legacy URLs used `?category=<x>` / `?works=<key>` on the bare /resource
  // route; canonical forms are now /resource/<x> and /resource/works.
  const legacyCategory = searchParams.get('category');
  const legacyWorksKey = isWorksPath ? null : parseWorkGalleryKey(searchParams.get('works'));
  const isInvalidPath = !!pathCategory && !isValidPathCategory && !isWorksPath;

  useLayoutEffect(() => {
    if (legacyWorksKey) {
      navigate('/resource/other', { replace: true });
      return;
    }
    if (legacyCategory) {
      navigate(resourceCategoryPath(legacyCategory as FilesTabs), { replace: true });
      return;
    }
    if (isInvalidPath) navigate('/resource', { replace: true });
    if (pathCategory && ['page', 'files', 'audios', 'works'].includes(pathCategory)) {
      const next = new URLSearchParams(searchParams);
      next.delete('works');
      navigate(`${resourceCategoryPath(categoryParam)}${next.size ? `?${next}` : ''}`, {
        replace: true,
      });
    }
  }, [
    legacyWorksKey,
    legacyCategory,
    isInvalidPath,
    navigate,
    pathCategory,
    categoryParam,
    searchParams,
  ]);

  // Clear libraryId when on home route using useLayoutEffect
  // useLayoutEffect runs synchronously before browser paint, ensuring state is cleared
  // before child components' useEffects run, while avoiding React's setState-in-render error
  // IMPORTANT: Only depend on location.pathname, NOT currentLibraryId to avoid feedback loop
  // When location changes to /resource, clear libraryId
  // Don't clear when location is /library/* (even if this component is still mounted)
  useLayoutEffect(() => {
    const isOnHomeRoute =
      location.pathname === '/resource' || !location.pathname.includes('/library/');
    if (isOnHomeRoute) {
      setLibraryId(undefined);
    }
  }, [setLibraryId, location.pathname]);

  // Sync category from URL using useLayoutEffect
  // IMPORTANT: Only sync if we're actually on the home route (not transitioning to library)
  useLayoutEffect(() => {
    const isOnHomeRoute =
      location.pathname === '/resource' || !location.pathname.includes('/library/');
    if (isOnHomeRoute) {
      setCategory(categoryParam);
    }
  }, [categoryParam, setCategory, location.pathname]);

  // Sync file view mode from URL
  useInitFileCheck();

  // 「其他」栏目：仍用标准页面外壳（ResourceManager），但内容喂产出物列表，
  // 否则按文件分类查出来是空的（库里文件都是图片，other 分类下没有文件）。
  if (categoryParam === FilesTabs.Other)
    return (
      <KnowledgeBaseListProvider>
        <ResourceManager content={<OtherResources />} />
      </KnowledgeBaseListProvider>
    );

  return <ResourceManager />;
});

ResourceHomePage.displayName = 'ResourceHomePage';

export default ResourceHomePage;
