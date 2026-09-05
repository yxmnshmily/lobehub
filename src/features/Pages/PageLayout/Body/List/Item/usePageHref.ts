import { useHref } from 'react-router';

import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

/** Resolve a page route through React Router so a mounted SPA keeps its basename. */
export const usePageHref = (pageId: string, workspaceSlug?: string | null) =>
  useHref(buildWorkspaceAwarePath(`/page/${pageId}`, workspaceSlug));
