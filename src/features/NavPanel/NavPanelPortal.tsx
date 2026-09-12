'use client';

import { memo, type PropsWithChildren, useLayoutEffect } from 'react';

import { useSingleton } from '@/hooks/useSingleton';

import { registerNavPanelContent, unregisterNavPanelContent } from './registry';

interface NavPanelPortalProps extends PropsWithChildren {
  /** Register this route as intentionally having no navigation panel. */
  hidden?: boolean;
  /**
   * Stable route-owned key used by NavPanelHost to select the active content.
   * @example <NavPanelPortal navKey="agent">...</NavPanelPortal>
   */
  navKey?: string;
}

export const NavPanelPortal = memo<NavPanelPortalProps>(
  ({ children, hidden = false, navKey = 'default' }) => {
    const owner = useSingleton(() => Symbol('NavPanelPortal'));

    useLayoutEffect(() => {
      if (!children && !hidden) return;

      registerNavPanelContent(navKey, owner, children, hidden);

      return () => {
        unregisterNavPanelContent(navKey, owner);
      };
    }, [children, hidden, navKey, owner]);

    return null;
  },
);

NavPanelPortal.displayName = 'NavPanelPortal';

export default NavPanelPortal;
