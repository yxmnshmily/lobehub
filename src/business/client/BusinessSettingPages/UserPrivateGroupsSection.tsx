'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Alert, Button, Select, Tag, Text } from '@lobehub/ui/base-ui';
import type { inferRouterOutputs } from '@trpc/server';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';
import { getTravelLocale, translateTravel, useTravelTranslation } from '@/utils/i18n/travel';

const PAGE_SIZE = 10;

type LambdaOutputs = inferRouterOutputs<LambdaRouter>;
type UserOverview = LambdaOutputs['platformOperations']['getUserOverview'];
type UserPrivateGroupCatalog = LambdaOutputs['platformOperations']['listUserPrivateGroups'];

const EMPTY_GROUPS: UserPrivateGroupCatalog['items'] = [];

interface PaginationState {
  cursors: Array<string | undefined>;
  pageIndex: number;
}

const formatDate = (value: Date | string | null) =>
  value
    ? new Intl.DateTimeFormat(getTravelLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : translateTravel('无');

const readinessLabel = (readiness?: UserOverview['travelGroup']['readiness']) => {
  if (readiness === 'ready') return translateTravel('群组已就绪');
  if (readiness === 'incomplete') return translateTravel('群组待补齐');
  if (readiness === 'missing') return translateTravel('群组未初始化');
  return translateTravel('群组状态读取中');
};

interface UserPrivateGroupsSectionProps {
  defaultGroup: UserOverview['travelGroup'] | undefined;
  userId: string;
}

const UserPrivateGroupsSection = ({ defaultGroup, userId }: UserPrivateGroupsSectionProps) => {
  const translateTravel = useTravelTranslation();
  const [groupPagination, setGroupPagination] = useState<PaginationState>({
    cursors: [undefined],
    pageIndex: 0,
  });
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const groupCursor = groupPagination.cursors[groupPagination.pageIndex];
  const groupsQuery = lambdaQuery.platformOperations.listUserPrivateGroups.useQuery(
    {
      ...(groupCursor ? { cursor: groupCursor } : {}),
      limit: PAGE_SIZE,
      targetUserId: userId,
    },
    { enabled: Boolean(userId), retry: false },
  );
  const groups = groupsQuery.data?.items ?? EMPTY_GROUPS;
  const selectedGroup = groups.find(({ id }) => id === selectedGroupId);

  useEffect(() => {
    if (groupsQuery.isLoading) return;
    if (groups.length === 0) {
      setSelectedGroupId('');
      return;
    }
    if (!selectedGroup) setSelectedGroupId(groups[0].id);
  }, [groups, groupsQuery.isLoading, selectedGroup]);

  const showNextGroupPage = () => {
    const nextCursor = groupsQuery.data?.nextCursor;
    if (!nextCursor) return;
    setSelectedGroupId('');
    setGroupPagination((current) => {
      const cursors = current.cursors.slice(0, current.pageIndex + 1);
      cursors[current.pageIndex + 1] = nextCursor;
      return { cursors, pageIndex: current.pageIndex + 1 };
    });
  };

  const showPreviousGroupPage = () => {
    setSelectedGroupId('');
    setGroupPagination((current) => ({
      ...current,
      pageIndex: Math.max(0, current.pageIndex - 1),
    }));
  };

  return (
    <Block
      aria-label={translateTravel('私人群组目录')}
      padding={20}
      role={'region'}
      style={{ maxWidth: '100%', minWidth: 0 }}
      variant={'outlined'}
    >
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Users size={18} />
            <Text weight={600}>{translateTravel('私人群组目录')}</Text>
          </Flexbox>
          <Tag>{translateTravel('只读')}</Tag>
        </Flexbox>

        {groupsQuery.error ? (
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Alert title={translateTravel('私人群组目录暂时无法读取')} />
            <Button onClick={() => void groupsQuery.refetch()}>
              {translateTravel('重试群组目录')}
            </Button>
          </Flexbox>
        ) : groupsQuery.isLoading ? (
          <Text color={'secondary'}>{translateTravel('正在读取私人群组…')}</Text>
        ) : groups.length === 0 ? (
          <Text color={'secondary'}>{translateTravel('该用户暂无私人群组')}</Text>
        ) : (
          <>
            <Flexbox gap={4}>
              <Text color={'secondary'}>{translateTravel('选择私人群组')}</Text>
              <Select
                aria-label={translateTravel('选择私人群组')}
                value={selectedGroupId}
                options={groups.map((group) => ({
                  label: group.title || group.clientId || group.id,
                  value: group.id,
                }))}
                onChange={setSelectedGroupId}
              />
            </Flexbox>

            {selectedGroup && (
              <Block padding={12} variant={'outlined'}>
                <Flexbox gap={6}>
                  <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                    <Text weight={600}>
                      {selectedGroup.title || selectedGroup.clientId || selectedGroup.id}
                    </Text>
                    <Tag
                      color={
                        selectedGroup.id === defaultGroup?.id && defaultGroup.readiness === 'ready'
                          ? 'green'
                          : undefined
                      }
                    >
                      {selectedGroup.id === defaultGroup?.id
                        ? readinessLabel(defaultGroup.readiness)
                        : translateTravel('非默认旅游群')}
                    </Tag>
                  </Flexbox>
                  {selectedGroup.description && (
                    <Text color={'secondary'}>{selectedGroup.description}</Text>
                  )}
                  <Text color={'secondary'}>
                    {translateTravel('更新时间：{{v0}}', {
                      v0: formatDate(selectedGroup.updatedAt),
                    })}
                  </Text>
                </Flexbox>
              </Block>
            )}

            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Button disabled={groupPagination.pageIndex === 0} onClick={showPreviousGroupPage}>
                {translateTravel('群组上一页')}
              </Button>
              <Button disabled={!groupsQuery.data?.nextCursor} onClick={showNextGroupPage}>
                {translateTravel('群组下一页')}
              </Button>
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Block>
  );
};

export default UserPrivateGroupsSection;
