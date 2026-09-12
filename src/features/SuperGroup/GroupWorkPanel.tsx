'use client';

import { Button, Text } from '@lobehub/ui/base-ui';

import WideScreenContainer from '@/features/WideScreenContainer';
import { useTravelTranslation } from '@/utils/i18n/travel';

import GroupWorkEntry from './GroupWorkEntry';
import { useGroupWorkRequest } from './useGroupWorkRequest';
import { useGroupWorkStatus } from './useGroupWorkStatus';

export default function GroupWorkPanel({ groupId }: { groupId: string }) {
  const t = useTravelTranslation();
  const { data = [], error, mutate } = useGroupWorkStatus(groupId);
  const items = error
    ? data.map((item) => ({ ...item, isRunning: false, status: '状态待更新' }))
    : data;
  return (
    <WideScreenContainer paddingBlock="12px 0" wrapperStyle={{ flexShrink: 0, marginBottom: -1 }}>
      <GroupWorkEntry
        items={items}
        onOpen={(item) => {
          useGroupWorkRequest.setState({
            request: {
              groupId,
              kind: item.kind,
              detail: { id: item.id, agentId: item.agentId, title: item.title },
            },
          });
        }}
        onSelect={(kind) => {
          useGroupWorkRequest.setState({ request: { groupId, kind } });
        }}
      />
      {error && (
        <Text type="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
          {t('进度更新失败，请重试')}{' '}
          <Button size="small" type="text" onClick={() => void mutate()}>
            {t('重试')}
          </Button>
        </Text>
      )}
    </WideScreenContainer>
  );
}
