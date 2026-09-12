'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Alert, Button, confirmModal, createModal, useModalContext } from '@lobehub/ui/base-ui';
import { ArrowDown, ArrowUp, ArrowUpDown, UserPlus } from 'lucide-react';
import { useState } from 'react';

import SkeletonBar from '@/components/Skeleton/Bar';
import SuperGroupTemplateSection from '@/business/client/BusinessSettingPages/SuperGroupTemplateSection';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';

import AddMemberMenu from './AddMemberMenu';
import InvitationForm from './InvitationForm';

export const DefaultGroupSortPanel = ({
  groupId,
  onUpdated,
}: {
  groupId: string;
  onUpdated?: () => Promise<unknown>;
}) => {
  const query = lambdaQuery.platformOperations.getSuperGroupTemplate.useQuery(undefined, {
    retry: false,
  });
  const mutation = lambdaQuery.platformOperations.reorderSuperGroupTemplateMembers.useMutation();
  const [keys, setKeys] = useState<string[]>();
  const [feedback, setFeedback] = useState('');
  if (query.isLoading) return <SkeletonBar height={120} />;
  if (!query.data || query.isError)
    return (
      <Alert
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
        title="成员列表加载失败"
        type="error"
      />
    );
  const members = query.data.members;
  const order = keys ?? members.map((member) => member.key);
  const move = (index: number, step: number) => {
    const next = [...order];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    setKeys(next);
  };
  return (
    <Flexbox gap={12}>
      <p>群主 AI 保持首位。调整下方成员后，确认同步所有用户的默认群。</p>
      {feedback && <p role="status">{feedback}</p>}
      {order.map((key, index) => (
        <Flexbox horizontal align="center" gap={8} key={key}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {members.find((member) => member.key === key)?.name ||
              members.find((member) => member.key === key)?.title ||
              key}
          </span>
          <ActionIcon
            aria-label={`上移第 ${index + 1} 位成员`}
            disabled={index === 0 || mutation.isPending}
            icon={ArrowUp}
            onClick={() => move(index, -1)}
          />
          <ActionIcon
            aria-label={`下移第 ${index + 1} 位成员`}
            disabled={index === order.length - 1 || mutation.isPending}
            icon={ArrowDown}
            onClick={() => move(index, 1)}
          />
        </Flexbox>
      ))}
      <Button
        disabled={!keys || mutation.isPending}
        onClick={() =>
          confirmModal({
            title: '同步所有默认群的成员顺序？',
            content: '所有现有用户和新用户的默认群将使用此顺序，不会删除成员或消息。',
            okText: '确认同步',
            onOk: async () => {
              try {
                const result = await mutation.mutateAsync({ keys: order });
                await Promise.all([
                  query.refetch(),
                  useAgentGroupStore.getState().refreshGroupDetail(groupId),
                  onUpdated?.(),
                ]);
                setKeys(undefined);
                setFeedback(`已同步到 ${result.syncedGroupCount} 个默认群`);
              } catch {
                setFeedback('同步失败，请刷新列表后重试；成员列表可能已被其他管理员修改。');
              }
            },
          })
        }
      >
        同步成员顺序
      </Button>
      <Button
        disabled={mutation.isPending}
        onClick={() => {
          setKeys(undefined);
          void query.refetch();
        }}
      >
        刷新列表
      </Button>
    </Flexbox>
  );
};

export default function DefaultGroupActions({
  groupId,
  addAsMenu = false,
  addOnly = false,
  onUpdated,
}: {
  groupId: string;
  addAsMenu?: boolean;
  addOnly?: boolean;
  onUpdated?: () => Promise<unknown>;
}) {
  const { close } = useModalContext();
  const access = lambdaQuery.platformAccess.isPlatformAdmin.useQuery(undefined, { retry: false });
  const canManage = access.data === true && !access.isLoading && !access.isError;
  const openAddMembers = () => {
    if (!canManage) return;
    close();
    createModal({
      title: '添加成员',
      content: (
        <Flexbox gap={16}>
          <InvitationForm groupId={groupId} />
          <SuperGroupTemplateSection
            onUpdated={async () => {
              await useAgentGroupStore.getState().refreshGroupDetail(groupId);
              await onUpdated?.();
            }}
          />
        </Flexbox>
      ),
      footer: null,
      width: 'min(560px, calc(100vw - 32px))',
    });
  };
  return (
    <>
      {!addOnly && (
        <ActionIcon
          aria-label="成员排序"
          disabled={!canManage}
          icon={ArrowUpDown}
          size="small"
          title={canManage ? '成员排序' : '由管理员统一排序'}
          onClick={() =>
            canManage &&
            createModal({
              title: '成员排序',
              content: <DefaultGroupSortPanel groupId={groupId} onUpdated={onUpdated} />,
              footer: null,
              width: 'min(480px, calc(100vw - 32px))',
            })
          }
        />
      )}
      {addAsMenu ? (
        <AddMemberMenu
          canManage={canManage}
          groupId={groupId}
          showLabel={addOnly}
          onAddFromList={openAddMembers}
        />
      ) : (
        <ActionIcon
          aria-label="添加成员"
          disabled={!canManage}
          icon={UserPlus}
          size="small"
          title={canManage ? '添加成员' : '由管理员统一添加成员'}
          onClick={openAddMembers}
        />
      )}
    </>
  );
}
