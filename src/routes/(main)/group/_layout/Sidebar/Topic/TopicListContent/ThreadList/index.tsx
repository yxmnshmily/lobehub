import { ThreadType } from '@lobechat/types';
import { ScrollShadow } from '@lobehub/ui';
import { memo } from 'react';

import { useFetchThreads } from '@/hooks/useFetchThreads';
import { useScrollActiveThreadIntoView } from '@/hooks/useScrollActiveThreadIntoView';
import { useChatStore } from '@/store/chat';
import { threadSelectors } from '@/store/chat/selectors';

import ThreadItem from './ThreadItem';

// Cap the nested thread list so a topic with many threads doesn't push the rest
// of the topic list off-screen; the overflow scrolls within the list itself.
// ~9 rows (NavItem 36px + 1px gap).
const MAX_HEIGHT = 9 * 37;

const ThreadList = memo(() => {
  const [id, activeThreadId] = useChatStore((s) => [s.activeTopicId, s.activeThreadId]);
  const threads = useChatStore(threadSelectors.getThreadsByTopic(id));
  // Isolation threads are internal AI execution records, not user-created navigation branches.
  const visibleThreads = threads?.filter((thread) => thread.type !== ThreadType.Isolation);

  useFetchThreads(id);

  const containerRef = useScrollActiveThreadIntoView(activeThreadId, visibleThreads?.length);

  if (!visibleThreads || visibleThreads.length === 0) return;

  return (
    <ScrollShadow
      gap={1}
      paddingBlock={1}
      ref={containerRef}
      size={12}
      style={{ maxHeight: MAX_HEIGHT }}
    >
      {visibleThreads.map((item, index) => (
        <ThreadItem id={item.id} index={index} key={item.id} title={item.title} />
      ))}
    </ScrollShadow>
  );
});

ThreadList.displayName = 'ThreadList';

export default ThreadList;
