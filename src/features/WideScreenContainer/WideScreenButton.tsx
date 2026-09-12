'use client';

import { memo, useEffect } from 'react';

import { useGlobalStore } from '@/store/global';

const WideScreenButton = memo(() => {
  useEffect(() => {
    // Also reset a previously saved wide-screen preference on these pages.
    useGlobalStore.getState().toggleWideScreen(false);
  }, []);

  return null;
});

export default WideScreenButton;
