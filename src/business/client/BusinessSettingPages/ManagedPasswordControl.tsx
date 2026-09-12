import { Flexbox, Input } from '@lobehub/ui';
import { Alert, Button, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { KeyRound } from 'lucide-react';
import { useRef, useState } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { useTravelTranslation } from '@/utils/i18n/travel';

export default function ManagedPasswordControl({
  userId,
  onChanged,
}: {
  userId: string;
  onChanged: () => Promise<void>;
}) {
  const translateTravel = useTravelTranslation();
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const mutation = lambdaQuery.platformOperations.setUserPassword.useMutation();
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    try {
      await mutation.mutateAsync({ targetUserId: userId, password });
      setPassword('');
      setVisible(false);
      setConfirm(false);
      toast.success(translateTravel('密码已修改，该用户需重新登录'));
      try {
        await onChanged();
      } catch {
        setError(translateTravel('密码已修改，但资料刷新失败，请刷新页面'));
      }
    } catch {
      setError(translateTravel('修改密码未安全完成，请重试；未设置密码登录的用户请使用邮件重置'));
    } finally {
      busy.current = false;
    }
  };
  return (
    <Flexbox gap={12} style={{ minWidth: 0 }}>
      <Flexbox horizontal align={'center'} gap={8}>
        <KeyRound aria-hidden size={18} />
        <Text weight={600}>{translateTravel('修改密码')}</Text>
      </Flexbox>
      <Input
        aria-label={translateTravel('新密码')}
        autoComplete="new-password"
        disabled={mutation.isPending}
        maxLength={128}
        type={visible ? 'text' : 'password'}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setConfirm(false);
        }}
      />
      <Text color="secondary">
        {translateTravel('请输入 12–128 个字符。仅能查看本次输入的新密码，不能查看用户原密码。')}
      </Text>
      <Flexbox horizontal gap={8} wrap="wrap">
        <Button aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? translateTravel('隐藏密码') : translateTravel('查看新密码')}
        </Button>
        <Button
          disabled={mutation.isPending || password.length < 12}
          onClick={() => setConfirm(true)}
        >
          {translateTravel('修改密码')}
        </Button>
      </Flexbox>
      {confirm && (
        <Flexbox
          gap={10}
          role="alertdialog"
          aria-label={translateTravel('确认修改密码')}
          style={{ padding: 16, background: cssVar.colorFillTertiary, borderRadius: 8 }}
        >
          <Text>
            {translateTravel('确认修改该用户密码？旧密码将失效，该用户全部设备需重新登录。')}
          </Text>
          <Flexbox horizontal gap={8} wrap="wrap">
            <Button disabled={mutation.isPending} onClick={() => setConfirm(false)}>
              {translateTravel('取消')}
            </Button>
            <Button loading={mutation.isPending} onClick={submit}>
              {translateTravel('确认修改密码')}
            </Button>
          </Flexbox>
        </Flexbox>
      )}
      {error && <Alert title={error} />}
    </Flexbox>
  );
}
