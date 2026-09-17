'use client';

import { GROUP_CHAT_URL, GROUP_RECENT_MESSAGE_LIMIT } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { History, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConversationStore, virtuaListSelectors } from '@/features/Conversation/store';
import { useQueryRoute } from '@/hooks/useQueryRoute';

export function GroupRecentNotice() {
  const atBottom = useConversationStore(virtuaListSelectors.atBottom);
  const direction = useConversationStore((s) => s.scrollDirection);
  const isScrolling = useConversationStore((s) => s.isScrolling);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (atBottom || direction !== 'up' || isScrolling) return;
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, [atBottom, direction, isScrolling]);
  const hidden = atBottom || direction !== 'up' || timedOut;
  return (
    <div
      aria-hidden={hidden}
      className={styles.recent}
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? 'translateY(-8px)' : 'translateY(0)',
        visibility: hidden ? 'hidden' : 'visible',
      }}
    >
      <History
        aria-hidden
        size={16}
        style={{ color: cssVar.colorTextSecondary, flexShrink: 0, marginTop: 2 }}
      />
      <Text style={{ fontSize: 12, lineHeight: '20px' }} type="secondary">
        主窗口显示最近 {GROUP_RECENT_MESSAGE_LIMIT} 条消息，较早记录保留在话题列表。
      </Text>
    </div>
  );
}

export function GroupHistoryAction({ groupId }: { groupId: string }) {
  const router = useQueryRoute();
  return (
    <ActionIcon
      aria-label="查看历史话题"
      icon={MessageSquare}
      title="查看历史话题"
      tooltipProps={{ placement: 'bottom' }}
      onClick={() => router.push(`${GROUP_CHAT_URL(groupId)}/topics`)}
    />
  );
}

const styles = createStaticStyles(({ css }) => ({
  recent: css`
    pointer-events: none;

    position: absolute;
    z-index: 4;
    inset-block-start: 8px;
    inset-inline: 16px;

    display: flex;
    gap: 8px;
    align-items: flex-start;

    width: fit-content;
    max-width: calc(100% - 32px);
    margin-inline: auto;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};

    transition:
      opacity 160ms ease,
      transform 160ms ease;

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  notice: css`
    @media (width <= 767px) {
      padding-inline: 0 !important;
    }
  `,
}));

export default function GroupHistoryNotice({
  groupId,
  history = false,
  sendToRecent = false,
}: {
  groupId: string;
  history?: boolean;
  sendToRecent?: boolean;
}) {
  const router = useQueryRoute();
  return (
    <Flexbox
      horizontal
      align="center"
      className={styles.notice}
      gap={8}
      justify="space-between"
      paddingBlock={6}
      paddingInline={16}
      style={{ flexWrap: 'wrap', flexShrink: 0 }}
    >
      <Text style={{ fontSize: 12 }} type="secondary">
        {history
          ? `正在查看所选话题，不加载其他话题。${sendToRecent ? '发送新消息后将返回近期聊天。' : ''}`
          : `主窗口显示最近 ${GROUP_RECENT_MESSAGE_LIMIT} 条消息，较早记录保留在话题列表。`}
      </Text>
      <Button
        size="small"
        type="text"
        onClick={() =>
          router.push(history ? GROUP_CHAT_URL(groupId) : `${GROUP_CHAT_URL(groupId)}/topics`)
        }
      >
        {history ? '返回近期聊天' : '查看历史话题'}
      </Button>
    </Flexbox>
  );
}
