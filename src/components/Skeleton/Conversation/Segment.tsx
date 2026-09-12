'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

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

const ComposerSkeleton = () => (
  <ConversationSkeletonContainer flex={'none'} paddingBlock={'0 8px'}>
    <Flexbox className={styles.composer} data-testid={'conversation-composer-skeleton'}>
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
        <Flexbox horizontal gap={6}>
          {[0, 1, 2, 3].map((key) => (
            <SkeletonBar height={24} key={key} radius={6} width={24} />
          ))}
        </Flexbox>
        <Flexbox horizontal align={'center'} gap={10}>
          <SkeletonBar height={14} width={80} />
          <SkeletonBar height={28} radius={'50%'} width={28} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
    <Flexbox horizontal align={'center'} gap={8} height={36} paddingInline={4}>
      <SkeletonBar height={22} radius={11} width={72} />
      <SkeletonBar height={22} radius={11} width={104} />
      <SkeletonBar height={22} radius={11} width={88} />
    </Flexbox>
  </ConversationSkeletonContainer>
);

const ConversationSegmentSkeleton = () => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    <ConversationListSkeleton />
    <ComposerSkeleton />
  </Flexbox>
);

export default ConversationSegmentSkeleton;
