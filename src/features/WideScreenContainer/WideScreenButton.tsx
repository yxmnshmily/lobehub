'use client';

import { memo, useEffect } from 'react';

import { useGlobalStore } from '@/store/global';

const WideScreenButton = memo<{ wide?: boolean }>(({ wide = false }) => {
  useEffect(() => {
    // Reset the persisted wide-screen preference on mount: memory pages pass
    // nothing (back to the capped narrow column); the group chat header passes
    // `wide` so the conversation column fills the window instead of leaving
    // all the leftover space on the right.
    useGlobalStore.getState().toggleWideScreen(wide);
  }, [wide]);

  return null;
});

export default WideScreenButton;
