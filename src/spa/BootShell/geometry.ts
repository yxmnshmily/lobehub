import { cssVar } from 'antd-style';

import { isDesktop } from '@/const/version';
import { useGlobalStore } from '@/store/global';
import { INITIAL_STATUS } from '@/store/global/initialState';
import { systemStatusSelectors } from '@/store/global/selectors';
import { isMacOS } from '@/utils/platform';

export interface BootShellGeometry {
  isDark: boolean;
  navPanelBackground: string;
  navPanelWidth: number;
  showLeftPanel: boolean;
}

const readIsDark = () => {
  try {
    return document.documentElement.dataset.theme === 'dark';
  } catch {
    return false;
  }
};

// Mirrors `NavPanelDraggable`'s panel background so the shell hands over to a
// panel of the same color instead of flashing an opaque block over vibrancy.
const readNavPanelBackground = () =>
  isDesktop && isMacOS() ? 'transparent' : cssVar.colorBgLayout;

/**
 * The boot shell draws a fluid, full-viewport brand loading screen: the brand
 * mark is centered in the whole viewport and the content card adapts to any
 * window size. Reserving a nav-panel column here (desktop widths, persisted
 * `showLeftPanel`, auth routes, …) kept squeezing that card into a narrow
 * right-hand column — a layout the very next paint often doesn't even have
 * (auth pages, collapsed navs, narrow windows). The real layout applies its
 * own chrome the moment it mounts; the shell stays adaptive instead.
 */
export const readBootShellGeometry = (): BootShellGeometry => {
  const base = {
    isDark: readIsDark(),
    navPanelBackground: readNavPanelBackground(),
  };

  try {
    const state = useGlobalStore.getState();

    return {
      ...base,
      navPanelWidth: systemStatusSelectors.leftPanelWidth(state),
      showLeftPanel: false,
    };
  } catch {
    return {
      ...base,
      navPanelWidth: INITIAL_STATUS.leftPanelWidth,
      showLeftPanel: false,
    };
  }
};
