'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { useLocation } from 'react-router';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import SkeletonBar from '../Bar';
import ConversationSkeletonContainer from './Container';
import ConversationListSkeleton from './List';

const styles = createStaticStyles(({ css }) => ({
  composer: css`
    overflow: hidden;

    height: 144px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgElevated};
    box-shadow: 0 4px 4px color-mix(in srgb, #000 4%, transparent);
  `,
}));

const ComposerSkeleton = () => {
  const { pathname } = useLocation();
  const isGroup = /\/group\//.test(pathname);
  const inputHeight = useGlobalStore(systemStatusSelectors.chatInputHeight);
  return (
    <ConversationSkeletonContainer flex={'none'} paddingBlock={'0 8px'}>
      {isGroup && (
        <Flexbox
          horizontal
          align="center"
          height={42}
          justify="space-around"
          paddingInline={16}
          style={{
            marginInline: '4%',
            marginTop: 12,
            border: `0.5px solid ${cssVar.colorBorderSecondary}`,
            borderRadius: '12px 12px 0 0',
            flexShrink: 0,
          }}
        >
          {[0, 1, 2].map((i) => (
            <SkeletonBar height={14} key={i} width={64} />
          ))}
        </Flexbox>
      )}
      <Flexbox
        className={styles.composer}
        data-testid={'conversation-composer-skeleton'}
        style={{ height: Math.min(320, Math.max(inputHeight || 0, 96)) + 40 }}
      >
        <Flexbox flex={1} paddingBlock={'12px 8px'} paddingInline={12}>
          <SkeletonBar height={14} width={'38%'} />
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          gap={16}
          height={40}
          justify={'space-between'}
          paddingInline={12}
        >
          <Flexbox horizontal gap={6} style={{ minWidth: 0, overflow: 'hidden' }}>
            {Array.from({ length: isGroup ? 8 : 4 }, (_, key) => key).map((key) => (
              <SkeletonBar height={24} key={key} radius={6} width={24} />
            ))}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={10} style={{ maxWidth: '46%', minWidth: 0 }}>
            <SkeletonBar height={14} width={isGroup ? 210 : 80} />
            <SkeletonBar height={28} radius={'50%'} width={28} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox align="center" height={22} justify="center">
        <SkeletonBar height={10} width={210} />
      </Flexbox>
    </ConversationSkeletonContainer>
  );
};

const ConversationSegmentSkeleton = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <ConversationListSkeleton />
    <ComposerSkeleton />
  </Flexbox>
);

export default ConversationSegmentSkeleton;
