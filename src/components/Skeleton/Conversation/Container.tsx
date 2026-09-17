'use client';

import type { ComponentProps } from 'react';

import WideScreenContainer from '@/features/WideScreenContainer';

// Reuse the live column's width, mobile gutters and persisted wide-screen setting.
const ConversationSkeletonContainer = ({
  flex,
  height,
  ...rest
}: ComponentProps<typeof WideScreenContainer>) => (
  <WideScreenContainer
    aria-busy
    flex={flex}
    height={height}
    wrapperStyle={{ flex, height, minHeight: 0, minWidth: 0 }}
    {...rest}
  />
);
export default ConversationSkeletonContainer;
