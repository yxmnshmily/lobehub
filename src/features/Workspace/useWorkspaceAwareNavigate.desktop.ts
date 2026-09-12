'use client';

import { use, useCallback } from 'react';
import { type NavigateOptions, type To } from 'react-router';

import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  navigateActiveTab,
  navigateActiveTabByDelta,
  navigateTab,
  navigateTabByDelta,
} from '@/features/Electron/navigation/activeTabNavigate';
import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { TabIdContext } from '@/features/Electron/TabHost/TabIdContext';
import {
  GroupProjectScopeContext,
  scopeProjectPath,
} from '@/features/Projects/Layout/GroupProjectScope';
import { GroupWorkScopeContext, scopeGroupWorkPath } from '@/features/SuperGroup/GroupWorkScope';

import type { WorkspaceAwareNavigateFunction } from './useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath, type WorkspaceAwareNavigateOptions } from './workspaceAwarePath';

export type { WorkspaceAwareNavigateOptions } from './workspaceAwarePath';

// The desktop shell (sidebars, titlebar, cmdk) renders outside the per-tab
// routers, so its `useNavigate` targets the frozen root router — route it into
// the ACTIVE tab's memory router. Content inside a tab tree captures its
// ORIGINATING tab id instead: an async callback (create → redirect) must
// navigate the tab it started in, not whichever tab is active when it fires.
export const useWorkspaceAwareNavigate = (): WorkspaceAwareNavigateFunction => {
  const tabId = use(TabIdContext);
  const projectScope = use(GroupProjectScopeContext);
  const groupScope = use(GroupWorkScopeContext);

  return useCallback(
    ((to: To | number, options?: WorkspaceAwareNavigateOptions) => {
      if (typeof to === 'number') {
        return tabId ? navigateTabByDelta(tabId, to) : navigateActiveTabByDelta(to);
      }
      if (typeof to !== 'string') {
        return tabId
          ? navigateTab(tabId, to, options as NavigateOptions)
          : navigateActiveTab(to, options as NavigateOptions);
      }
      const scopedTo = scopeGroupWorkPath(scopeProjectPath(to, projectScope), groupScope);
      if (!tabId) return appNavigate(scopedTo, options);

      const { escape, ...navOptions } = options ?? {};
      const resolved = buildWorkspaceAwarePath(scopedTo, getActiveWorkspaceSlug(), { escape });
      return navigateTab(tabId, resolved, navOptions);
    }) as WorkspaceAwareNavigateFunction,
    [tabId, projectScope, groupScope],
  );
};
