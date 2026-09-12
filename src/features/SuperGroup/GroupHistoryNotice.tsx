'use client';

import { GROUP_CHAT_URL, GROUP_RECENT_MESSAGE_LIMIT } from '@lobechat/const';
import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';

import { useQueryRoute } from '@/hooks/useQueryRoute';

const styles = createStaticStyles(({ css }) => ({
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
