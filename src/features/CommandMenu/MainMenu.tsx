import { GROUP_CHAT_TOPIC_URL } from '@lobechat/const';
import { Command } from 'cmdk';
import { MessageSquare } from 'lucide-react';
import { memo } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { lambdaQuery } from '@/libs/trpc/client';

import { CommandItem } from './components';

/** 我的超级工作组（群话题）：从群页面 URL /group/<id>/topics 确认 */
const SUPER_GROUP_ID = 'cg_h4b2CBuBznIb';
const RECENT_TOPIC_LIMIT = 10;

/**
 * 命令面板主列表：按要求只保留「超级工作群的最近 10 条话题」。
 * 原来的新建成员 / 新建文稿 / 设置 / 主题 / 导航等入口已移除。
 * 点一条话题直接跳进该群的这个话题。
 */
const MainMenu = memo(() => {
  const navigate = useWorkspaceAwareNavigate();

  const query = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId: SUPER_GROUP_ID, limit: RECENT_TOPIC_LIMIT, recent: true },
    { retry: false },
  );

  const topics = query.data?.items ?? [];

  return (
    <Command.Group heading={'超级工作群 · 最近话题'}>
      {query.isLoading && topics.length === 0 && (
        <Command.Loading style={{ padding: '12px 8px', opacity: 0.6 }}>加载中…</Command.Loading>
      )}

      {!query.isLoading && topics.length === 0 && (
        <Command.Empty style={{ padding: '12px 8px', opacity: 0.6 }}>
          这个群还没有话题
        </Command.Empty>
      )}

      {topics.map((topic: any) => (
        <CommandItem
          icon={<MessageSquare />}
          key={topic.id}
          value={`topic ${topic.id} ${topic.title || topic.latestMessage || ''}`}
          onSelect={() => navigate(GROUP_CHAT_TOPIC_URL(SUPER_GROUP_ID, topic.id))}
        >
          {topic.title || topic.latestMessage || '未命名话题'}
        </CommandItem>
      ))}
    </Command.Group>
  );
});

MainMenu.displayName = 'MainMenu';

export default MainMenu;
