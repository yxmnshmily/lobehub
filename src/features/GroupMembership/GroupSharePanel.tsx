'use client';

import { Flexbox } from '@lobehub/ui';
import { Tabs, Text, useModalContext } from '@lobehub/ui/base-ui';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GroupLinkPanel } from './GroupShareButton';

export default function GroupSharePanel({
  groupId,
  topicContent,
}: {
  groupId: string;
  topicContent: (close: () => void) => ReactNode;
}) {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const [tab, setTab] = useState('invite');
  const [topicVisited, setTopicVisited] = useState(false);
  return (
    <Flexbox gap={16}>
      <Tabs
        activeKey={tab}
        variant="rounded"
        items={[
          { key: 'invite', label: t('groupInvitation.share') },
          { key: 'topic', label: t('shareModal.popover.title') },
        ]}
        onChange={(key) => {
          setTab(key);
          if (key === 'topic') setTopicVisited(true);
        }}
      />
      <div hidden={tab !== 'invite'} role="tabpanel">
        <GroupLinkPanel groupId={groupId} />
      </div>
      {topicVisited && (
        <div hidden={tab !== 'topic'} role="tabpanel">
          {topicContent(close) || (
            <Text type="secondary">{t('shareModal.popover.visibleTopicMissing')}</Text>
          )}
        </div>
      )}
    </Flexbox>
  );
}
