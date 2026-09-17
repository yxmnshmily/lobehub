'use client';

import { useResponsive } from 'antd-style';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { resolveNavPanelPresentation, supportsCompactNavRail } from '../presentation';
import { useActiveNavKey } from '../useActiveNavKey';

/**
 * Whether the left nav panel is *effectively* expanded right now.
 *
 * The 64px shell decides its width from the same inputs (user preference AND
 * viewport): below the `xl` breakpoint (1200px — covers iPad mini in both
 * orientations) a panel that supports the compact rail auto-compacts regardless
 * of the saved preference. Route sidebars must derive their presentation from
 * this hook — reading `showLeftPanel` alone renders a full menu into a 64px
 * rail on narrow widths.
 */
export const useEffectiveNavPanelExpanded = (): boolean => {
  const navKey = useActiveNavKey();
  const userExpanded = useGlobalStore(systemStatusSelectors.showLeftPanel);
  const { xl } = useResponsive();

  const { compact } = resolveNavPanelPresentation({
    supportsCompactRail: supportsCompactNavRail(navKey),
    userExpanded: userExpanded ?? true,
    viewportAllowsExpanded: xl,
  });

  return !compact;
};
