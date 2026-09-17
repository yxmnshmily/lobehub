'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { useLocation } from 'react-router';

import NavHeader from '@/features/NavHeader';
import ConversationFrame from '@/features/SuperGroup/ConversationFrame';
import { useIsMobile } from '@/hooks/useIsMobile';

import SkeletonBar from '../Bar';
import ConversationSegmentSkeleton from './Segment';

const ConversationLayoutSkeleton = () => {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const isGroup = /\/group\//.test(pathname);
  const header = (
    <NavHeader
      height={isGroup ? 56 : 44}
      paddingInline={isGroup ? 16 : undefined}
      left={
        <Flexbox horizontal align="center" gap={8}>
          <SkeletonBar height={24} width={24} />
          <SkeletonBar height={18} width={isMobile ? 88 : isGroup ? 168 : 120} />
        </Flexbox>
      }
      right={
        <Flexbox horizontal gap={8}>
          {Array.from({ length: isMobile ? 2 : isGroup ? 6 : 3 }, (_, i) => (
            <SkeletonBar height={28} key={i} width={28} />
          ))}
        </Flexbox>
      }
      style={
        isGroup
          ? { minHeight: 56, borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}` }
          : undefined
      }
    />
  );
  if (isGroup)
    return (
      <ConversationFrame header={header}>
        <ConversationSegmentSkeleton />
      </ConversationFrame>
    );
  return (
    <Flexbox aria-busy flex={1} height="100%" style={{ minHeight: 0, overflow: 'hidden' }}>
      {header}
      <ConversationSegmentSkeleton />
    </Flexbox>
  );
};

export default ConversationLayoutSkeleton;
