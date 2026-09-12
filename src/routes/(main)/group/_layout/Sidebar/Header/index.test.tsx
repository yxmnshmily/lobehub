import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import GroupSidebarHeader from '@/features/SuperGroup/GroupSidebarHeader';

const queryTopics = vi.hoisted(() => vi.fn());
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: { listTopics: { useInfiniteQuery: queryTopics } },
  },
}));

it.each([true, false])('omits the duplicate home/count row (managed=%s)', (managed) => {
  const { container } = render(
    <GroupSidebarHeader groupId="group" managed={managed} onHome={vi.fn()} />,
  );

  expect(container).toBeEmptyDOMElement();
  expect(queryTopics).not.toHaveBeenCalled();
});
