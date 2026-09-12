import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Text, toast } from '@lobehub/ui/base-ui';
import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { USER_DELETION_ERRORS } from '@/const/userDeletion';
import { lambdaQuery } from '@/libs/trpc/client';
import { useTravelTranslation } from '@/utils/i18n/travel';

export default function ManagedDeleteControl({
  userId,
  userLabel,
  onDeleted,
}: {
  userId: string;
  userLabel: string;
  onDeleted: () => Promise<void>;
}) {
  const translateTravel = useTravelTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mutation = lambdaQuery.platformOperations.deleteUser.useMutation();
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    try {
      await mutation.mutateAsync({ targetUserId: userId, confirmed: true });
      toast.success(translateTravel('用户及其账户数据已永久删除'));
      try {
        await onDeleted();
      } catch {
        toast.error(translateTravel('删除已成功，列表刷新失败，请刷新页面'));
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        Object.values(USER_DELETION_ERRORS).includes(message)
          ? message
          : translateTravel('删除请求失败，暂无法确认账号状态。请刷新用户资料后重试。'),
      );
    } finally {
      busy.current = false;
    }
  };
  return (
    <Flexbox gap={12} style={{ padding: 20, minWidth: 0, boxSizing: 'border-box', width: '100%' }}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Trash2 aria-hidden size={18} />
        <Text weight={600}>{translateTravel('删除账号')}</Text>
      </Flexbox>
      <Text color="secondary">{translateTravel('永久删除用户及其账户数据，此操作不可恢复。')}</Text>
      <Button
        danger
        disabled={mutation.isPending}
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpen(!open)}
      >
        {translateTravel('删除用户')}
      </Button>
      {open && (
        <Flexbox role="alertdialog" aria-label={translateTravel('永久删除用户')} gap={10}>
          <Text>
            {translateTravel('确认永久删除用户“')}
            {userLabel}
            {translateTravel(
              '”及其积分账本、订单和历史记录？不可恢复。\n            其他用户拥有的共享数据和系统操作审计记录不删除。',
            )}
          </Text>
          <Flexbox horizontal gap={8} wrap="wrap">
            <Button
              disabled={mutation.isPending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {translateTravel('取消')}
            </Button>
            <Button
              danger
              disabled={mutation.isPending}
              loading={mutation.isPending}
              onClick={submit}
            >
              {translateTravel('确认永久删除')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}
      {error && <Alert title={error} />}
    </Flexbox>
  );
}
