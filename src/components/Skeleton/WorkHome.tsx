'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import { TaskTemplateCardSkeleton } from '@/features/RecommendTaskTemplates/TaskTemplateCardSkeleton';

import SkeletonBar from './Bar';

const styles = createStaticStyles(({ css }) => ({
  examples: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;

    @media (width <= 860px) {
      grid-template-columns: 1fr;
    }
  `,
  templates: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (width <= 768px) {
      grid-template-columns: 1fr;
    }
  `,
}));

export const GoalHomeSkeleton = () => (
  <Flexbox gap={24}>
    <Flexbox align="center" gap={16} padding="40px 40px 32px">
      <Flexbox align="center" height={72} justify="center">
        <SkeletonBar height={40} width={64} />
      </Flexbox>
      <SkeletonBar height={24} width={180} />
      <SkeletonBar height={14} width="min(560px, 100%)" />
      <SkeletonBar height={14} width="min(420px, 80%)" />
      <SkeletonBar height={36} width={144} />
    </Flexbox>
    <Flexbox gap={14} padding="24px 40px">
      <SkeletonBar height={16} width={72} />
      <div className={styles.examples}>
        {[0, 1, 2].map((i) => (
          <Flexbox
            horizontal
            align="center"
            gap={12}
            key={i}
            padding="12px 14px"
            style={{
              border: `1px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: cssVar.borderRadius,
            }}
          >
            <SkeletonBar height={32} width={32} />
            <Flexbox flex={1} gap={8}>
              <SkeletonBar height={12} width="42%" />
              <SkeletonBar height={14} width="88%" />
            </Flexbox>
          </Flexbox>
        ))}
      </div>
      <SkeletonBar height={64} />
    </Flexbox>
  </Flexbox>
);

export const TaskHomeSkeleton = () => (
  <Flexbox gap={32} paddingBlock={48}>
    <Flexbox align="center">
      <SkeletonBar height={32} width={240} />
    </Flexbox>
    <Flexbox
      gap={16}
      padding={16}
      style={{
        border: `1px solid ${cssVar.colorBorderSecondary}`,
        borderRadius: cssVar.borderRadiusLG,
      }}
    >
      <SkeletonBar height={20} width={160} />
      <div style={{ height: 48 }} />
      <Flexbox horizontal gap={16} justify="space-between">
        <SkeletonBar height={28} width="min(220px, 60%)" />
        <SkeletonBar height={28} width={88} />
      </Flexbox>
    </Flexbox>
    <Flexbox gap={12}>
      <SkeletonBar height={16} width={112} />
      <div className={styles.templates}>
        {[0, 1, 2, 3].map((i) => (
          <TaskTemplateCardSkeleton descriptionRows={2} key={i} />
        ))}
      </div>
    </Flexbox>
  </Flexbox>
);
