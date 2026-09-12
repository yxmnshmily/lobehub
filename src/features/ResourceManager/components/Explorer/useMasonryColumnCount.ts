import { useResponsive } from 'antd-style';
import { useLayoutEffect, useState } from 'react';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

export const resolveMasonryColumnCount = (width: number, mobile = false) => {
  if (width < 360) return 1;
  if (mobile || width < 768) return 2;
  if (width < 1024) return 3;
  if (width < 1536) return 4;
  return 5;
};

/**
 * Calculate the masonry column count from both the active app shell and viewport width.
 * Mobile routes stay at two columns when previewed inside a wide host window, while
 * very narrow phone viewports drop to one column to preserve touch-action space.
 */
export const useMasonryColumnCount = () => {
  const { mobile: responsiveMobile = false } = useResponsive();
  const runtimeMobile = useServerConfigStore(serverConfigSelectors.isMobile);
  const mobile = responsiveMobile || runtimeMobile;
  const [columnCount, setColumnCount] = useState(() =>
    resolveMasonryColumnCount(typeof window === 'undefined' ? 1024 : window.innerWidth, mobile),
  );

  useLayoutEffect(() => {
    const updateColumnCount = () => {
      setColumnCount(resolveMasonryColumnCount(window.innerWidth, mobile));
    };

    updateColumnCount();
    window.addEventListener('resize', updateColumnCount);
    return () => window.removeEventListener('resize', updateColumnCount);
  }, [mobile]);

  return columnCount;
};
