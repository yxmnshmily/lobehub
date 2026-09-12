'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, responsive } from 'antd-style';

import NavHeader from '@/features/NavHeader';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';

// Match the member overview without loading its menus, queries or action handlers.
const styles = createStaticStyles(({ css }) => ({
  overview: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    ${responsive.md} {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    ${responsive.sm} {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
}));

export const MemberRowsSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <Flexbox aria-busy gap={4}>
    {Array.from({ length: rows }, (_, key) => (
      <Flexbox horizontal align={'center'} gap={12} key={key} padding={12}>
        <SkeletonBar height={32} radius={8} width={32} />
        <Flexbox flex={1} gap={6} style={{ minWidth: 0 }}>
          <SkeletonBar height={16} width={160} />
          <SkeletonBar height={12} width={'38%'} />
        </Flexbox>
        <SkeletonBar height={24} width={48} />
      </Flexbox>
    ))}
  </Flexbox>
);

const MembersSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => (
  <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, overflow: 'hidden' }}>
    {chrome !== 'body' && <NavHeader left={<SkeletonBar height={18} width={112} />} />}
    <Flexbox
      gap={16}
      padding={chrome === 'body' ? 0 : 16}
      style={{ minWidth: 0, overflow: 'hidden' }}
    >
      <Flexbox className={styles.overview} gap={12}>
        <SkeletonBar height={16} width={112} />
        <div className={styles.grid}>
          {[0, 1, 2].map((key) => (
            <Block
              gap={6}
              key={key}
              padding={'10px 12px'}
              style={{ minHeight: 72 }}
              variant={'outlined'}
            >
              <Flexbox horizontal align={'center'} gap={8}>
                <SkeletonBar height={28} radius={8} width={28} />
                <SkeletonBar height={14} width={'40%'} />
                <SkeletonBar height={20} width={64} />
              </Flexbox>
              <SkeletonBar height={12} width={'84%'} />
            </Block>
          ))}
        </div>
      </Flexbox>
      <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
        <SkeletonBar height={36} width={240} />
        <SkeletonBar height={32} width={72} />
      </Flexbox>
      <MemberRowsSkeleton />
    </Flexbox>
  </Flexbox>
);

export default MembersSkeleton;
