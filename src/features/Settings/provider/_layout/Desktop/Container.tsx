'use client';

import { Flexbox } from '@lobehub/ui';
import { type FC, type PropsWithChildren, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import SettingContainer from '@/features/Setting/SettingContainer';

const Container: FC<PropsWithChildren> = ({ children }) => {
  // This layout outlives a provider switch, so its scroll box keeps whatever
  // offset the previous provider was left at and the next one opens partway
  // down the page. Keyed on pathname rather than the route param: `:providerId`
  // is matched by the child route, so it is not visible from this layout.
  const { pathname } = useLocation();
  const scrollRef = useRef<HTMLElement>(null);

  // Before paint, so switching providers never flashes the old offset.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    <Flexbox style={{ minHeight: '100%', width: '100%' }}>
      {/* The title is rendered by the shared settings shell so every tab's
          header starts on the same 48px line. */}
      <SettingContainer
        maxWidth={'100%'}
        /* 48px page gutter, same as every other settings tab. */
        padding={48}
        ref={scrollRef}
      >
        {children}
      </SettingContainer>
    </Flexbox>
  );
};
export default Container;
