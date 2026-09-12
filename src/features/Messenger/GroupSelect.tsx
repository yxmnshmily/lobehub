'use client';

import { Flexbox } from '@lobehub/ui';
import { Avatar, Button, Select, type SelectProps, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { messengerService } from '@/services/messenger';

interface GroupSelectProps extends Omit<SelectProps<string>, 'options' | 'value' | 'onChange'> {
  onChange?: (groupId: string | undefined) => void;
  value?: string;
  workspaceId?: string | null;
}

export default function GroupSelect({ value, onChange, workspaceId, ...rest }: GroupSelectProps) {
  const { t } = useTranslation('messenger');
  const { data, error, isLoading, mutate } = useSWR(
    ['messenger:groupsForBinding', workspaceId ?? null],
    () => messengerService.listGroupsForBinding(workspaceId),
  );
  return (
    <Flexbox gap={6}>
      <Select
        {...rest}
        loading={isLoading}
        value={value ?? null}
        options={(data ?? []).map((group) => ({
          value: group.id,
          title: group.title || t('messenger.unnamedGroup'),
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <Avatar avatar={group.avatar || '👥'} size={20} />
              <Text ellipsis>{group.title || t('messenger.unnamedGroup')}</Text>
            </Flexbox>
          ),
        }))}
        onChange={(next) => onChange?.((next as string | null) ?? undefined)}
      />
      {error ? (
        <Button size="small" onClick={() => void mutate()}>
          {t('messenger.groupLoadRetry')}
        </Button>
      ) : !isLoading && data?.length === 0 ? (
        <Text type="secondary">{t('messenger.groupsEmpty')}</Text>
      ) : null}
    </Flexbox>
  );
}
