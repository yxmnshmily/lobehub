'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Alert, Button, Select, Tag, Text } from '@lobehub/ui/base-ui';
import type { inferRouterOutputs } from '@trpc/server';
import { Users } from 'lucide-react';
import { useEffect, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import type { LambdaRouter } from '@/server/routers/lambda';

const PAGE_SIZE = 10;

type LambdaOutputs = inferRouterOutputs<LambdaRouter>;
type UserOverview = LambdaOutputs['platformOperations']['getUserOverview'];
type UserPrivateGroupCatalog = LambdaOutputs['platformOperations']['listUserPrivateGroups'];
type UserPrivateGroupMembers = LambdaOutputs['platformOperations']['getUserPrivateGroupMembers'];

const EMPTY_GROUPS: UserPrivateGroupCatalog['items'] = [];
const EMPTY_MEMBERS: UserPrivateGroupMembers['items'] = [];

interface PaginationState {
  cursors: Array<string | undefined>;
  pageIndex: number;
}

const formatDate = (value: Date | string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '无';

const readinessLabel = (readiness?: UserOverview['travelGroup']['readiness']) => {
  if (readiness === 'ready') return '群组已就绪';
  if (readiness === 'incomplete') return '群组待补齐';
  if (readiness === 'missing') return '群组未初始化';
  return '群组状态读取中';
};

const roleLabel = (role: string) => {
  if (role === 'supervisor') return '群主';
  if (role === 'participant') return '普通成员';
  return '其他成员';
};

interface UserPrivateGroupsSectionProps {
  defaultGroup: UserOverview['travelGroup'] | undefined;
  userId: string;
}

const UserPrivateGroupsSection = ({ defaultGroup, userId }: UserPrivateGroupsSectionProps) => {
  const [groupPagination, setGroupPagination] = useState<PaginationState>({
    cursors: [undefined],
    pageIndex: 0,
  });
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [memberPagination, setMemberPagination] = useState<PaginationState & { groupId: string }>({
    cursors: [undefined],
    groupId: '',
    pageIndex: 0,
  });
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
  const activeGroupId = groupsQuery.isLoading ? '' : (selectedGroup?.id ?? '');
  const activeMemberPagination =
    memberPagination.groupId === activeGroupId
      ? memberPagination
      : { cursors: [undefined], groupId: activeGroupId, pageIndex: 0 };
  const memberCursor = activeMemberPagination.cursors[activeMemberPagination.pageIndex];
  const membersQuery = lambdaQuery.platformOperations.getUserPrivateGroupMembers.useQuery(
    {
      ...(memberCursor ? { cursor: memberCursor } : {}),
      groupId: activeGroupId,
      limit: PAGE_SIZE,
      targetUserId: userId,
    },
    { enabled: Boolean(activeGroupId), retry: false },
  );
  const members = membersQuery.data?.items ?? EMPTY_MEMBERS;

  useEffect(() => {
    if (groupsQuery.isLoading) return;
    if (groups.length === 0) {
      setSelectedGroupId('');
      return;
    }
    if (!selectedGroup) setSelectedGroupId(groups[0].id);
  }, [groups, groupsQuery.isLoading, selectedGroup]);

  useEffect(() => {
    setMemberPagination({ cursors: [undefined], groupId: selectedGroupId, pageIndex: 0 });
  }, [selectedGroupId]);

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

  const showNextMemberPage = () => {
    const nextCursor = membersQuery.data?.nextCursor;
    if (!nextCursor || !activeGroupId) return;
    setMemberPagination((current) => {
      const base =
        current.groupId === activeGroupId
          ? current
          : { cursors: [undefined], groupId: activeGroupId, pageIndex: 0 };
      const cursors = base.cursors.slice(0, base.pageIndex + 1);
      cursors[base.pageIndex + 1] = nextCursor;
      return { cursors, groupId: activeGroupId, pageIndex: base.pageIndex + 1 };
    });
  };

  const showPreviousMemberPage = () => {
    setMemberPagination((current) => ({
      ...current,
      pageIndex: Math.max(0, current.pageIndex - 1),
    }));
  };

  return (
    <Block
      aria-label={'私人群组目录'}
      padding={20}
      role={'region'}
      style={{ maxWidth: '100%', minWidth: 0 }}
      variant={'outlined'}
    >
      <Flexbox gap={12}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Users size={18} />
            <Text weight={600}>{'私人群组目录'}</Text>
          </Flexbox>
          <Tag>{'只读'}</Tag>
        </Flexbox>
        <Text color={'secondary'}>
          {'仅显示群组与成员摘要；不读取提示词、模型、服务商、密钥或群配置。'}
        </Text>

        {groupsQuery.error ? (
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            <Alert title={'私人群组目录暂时无法读取'} />
            <Button onClick={() => void groupsQuery.refetch()}>{'重试群组目录'}</Button>
          </Flexbox>
        ) : groupsQuery.isLoading ? (
          <Text color={'secondary'}>{'正在读取私人群组…'}</Text>
        ) : groups.length === 0 ? (
          <Text color={'secondary'}>{'该用户暂无私人群组'}</Text>
        ) : (
          <>
            <Flexbox gap={4}>
              <Text color={'secondary'}>{'选择私人群组'}</Text>
              <Select
                aria-label={'选择私人群组'}
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
                        : '非默认旅游群'}
                    </Tag>
                  </Flexbox>
                  {selectedGroup.description && (
                    <Text color={'secondary'}>{selectedGroup.description}</Text>
                  )}
                  <Text
                    color={'secondary'}
                  >{`更新时间：${formatDate(selectedGroup.updatedAt)}`}</Text>
                </Flexbox>
              </Block>
            )}

            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Button disabled={groupPagination.pageIndex === 0} onClick={showPreviousGroupPage}>
                {'群组上一页'}
              </Button>
              <Button disabled={!groupsQuery.data?.nextCursor} onClick={showNextGroupPage}>
                {'群组下一页'}
              </Button>
            </Flexbox>

            {selectedGroup && (
              <Flexbox gap={8}>
                <Text weight={600}>{'成员摘要'}</Text>
                {membersQuery.error ? (
                  <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                    <Alert title={'私人群组成员暂时无法读取'} />
                    <Button onClick={() => void membersQuery.refetch()}>{'重试成员摘要'}</Button>
                  </Flexbox>
                ) : membersQuery.isLoading ? (
                  <Text color={'secondary'}>{'正在读取成员…'}</Text>
                ) : members.length === 0 ? (
                  <Text color={'secondary'}>{'该群暂无可显示成员'}</Text>
                ) : (
                  members.map((member) => (
                    <Block key={member.agentId} padding={10} variant={'outlined'}>
                      <Flexbox gap={5} style={{ minWidth: 0 }}>
                        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
                          <Text weight={600}>
                            {member.name || member.clientId || member.agentId}
                          </Text>
                          <Tag>{roleLabel(member.role)}</Tag>
                          <Tag color={member.enabled ? 'green' : undefined}>
                            {member.enabled ? '已启用' : '已停用'}
                          </Tag>
                        </Flexbox>
                        {member.description && (
                          <Text color={'secondary'}>{member.description}</Text>
                        )}
                      </Flexbox>
                    </Block>
                  ))
                )}

                {!membersQuery.error && !membersQuery.isLoading && (
                  <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
                    <Button
                      disabled={activeMemberPagination.pageIndex === 0}
                      onClick={showPreviousMemberPage}
                    >
                      {'成员上一页'}
                    </Button>
                    <Button disabled={!membersQuery.data?.nextCursor} onClick={showNextMemberPage}>
                      {'成员下一页'}
                    </Button>
                  </Flexbox>
                )}
              </Flexbox>
            )}
          </>
        )}
      </Flexbox>
    </Block>
  );
};

export default UserPrivateGroupsSection;
