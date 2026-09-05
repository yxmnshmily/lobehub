'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader as MobileChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from 'antd-style';
import { ChevronLeft, History } from 'lucide-react';
import { memo, Suspense } from 'react';

import { AgentMigrationBadge } from '@/features/AgentTransferMigration';
import NavHeader from '@/features/NavHeader';
import WideScreenButton from '@/features/WideScreenContainer/WideScreenButton';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useGlobalStore } from '@/store/global';
import { useServerConfigStore } from '@/store/serverConfig';

import ShareButton from './ShareButton';

const Header = memo(() => {
  const router = useQueryRoute();
  const isMobile = useServerConfigStore((state) => state.isMobile);
  const toggleMobileTopic = useGlobalStore((state) => state.toggleMobileTopic);
  // Same source as `useGroupContext` — the resolved group, not the route-synced
  // chat-store global, which is transiently empty on navigation.
  const groupId = useAgentGroupStore((s) => s.activeGroupId);
  const groupTitle = useAgentGroupStore((state) =>
    state.activeGroupId ? state.groupMap[state.activeGroupId]?.title : undefined,
  );

  if (isMobile) {
    return (
      <MobileChatHeader
        center={<MobileChatHeader.Title title={groupTitle || '群聊'} />}
        style={{ width: '100%' }}
        left={
          <ActionIcon
            aria-label="返回"
            icon={ChevronLeft}
            title="返回"
            onClick={() => router.push('/', { replace: true })}
          />
        }
        right={
          <Flexbox horizontal align={'center'} gap={4}>
            <ActionIcon
              aria-label="历史会话"
              icon={History}
              title="历史会话"
              onClick={() => toggleMobileTopic(true)}
            />
            <Suspense>
              <ShareButton mobile />
            </Suspense>
          </Flexbox>
        }
      />
    );
  }

  return (
    <NavHeader
      right={
        <Flexbox
          horizontal
          align={'center'}
          gap={8}
          style={{ backgroundColor: cssVar.colorBgContainer }}
        >
          {/* Progress chip for a heavy group transfer/copy still filling in its
              conversations; renders nothing once the backfill finishes. */}
          {groupId && <AgentMigrationBadge groupId={groupId} />}
          <WideScreenButton />
          <Suspense>
            <ShareButton />
          </Suspense>
        </Flexbox>
      }
    />
  );
});

export default Header;
