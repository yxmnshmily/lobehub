'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Divider } from 'antd';
import { Fragment } from 'react';
import { useLocation } from 'react-router';

import TaskItemSkeleton from '@/features/AgentTasks/AgentTaskList/TaskItemSkeleton';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import type { RouteSkeletonProps } from '@/spa/router/routeMeta';

import SkeletonBar from './Bar';
import { TaskHomeSkeleton } from './WorkHome';

const TasksSkeleton = ({ chrome = 'page' }: RouteSkeletonProps) => {
  const { pathname, search } = useLocation();
  const query = new URLSearchParams(search);
  const isHome =
    /\/group\/[^/]+\/tasks$/.test(pathname) &&
    query.get('view') !== 'history' &&
    (query.get('collection') ?? 'tasks') === 'tasks';
  return (
    <Flexbox aria-busy flex={1} height={'100%'} style={{ minHeight: 0, minWidth: 0 }}>
      {chrome !== 'body' && (
        <>
          <NavHeader />
          <Flexbox horizontal gap={8} padding={16}>
            <SkeletonBar height={28} width={48} />
            <SkeletonBar height={28} width={72} />
          </Flexbox>
        </>
      )}
      <WideScreenContainer
        fullWidth
        gap={16}
        paddingBlock={isHome ? 0 : 16}
        paddingInline={chrome === 'body' ? 0 : 16}
        wrapperStyle={{ flex: 1, overflowY: 'auto' }}
      >
        {isHome ? (
          <TaskHomeSkeleton />
        ) : (
          <>
            <Block gap={2} padding={2} variant={'borderless'}>
              {Array.from({ length: 5 }).map((_, index) => (
                <Fragment key={index}>
                  <TaskItemSkeleton />
                  {index !== 4 && <Divider dashed style={{ margin: 0 }} />}
                </Fragment>
              ))}
            </Block>
          </>
        )}
      </WideScreenContainer>
    </Flexbox>
  );
};

export default TasksSkeleton;
