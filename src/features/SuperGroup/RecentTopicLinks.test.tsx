import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RecentTopicLinks from './RecentTopicLinks';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  mobile: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@/hooks/useQueryRoute', () => ({
  useQueryRoute: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock('@/hooks/useActiveLocation', () => ({
  useActiveLocation: () => ({ pathname: window.location.pathname }),
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector({ topicDataMap: {} }),
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: any) => selector({ toggleMobileTopic: mocks.mobile }),
}));
vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title, onClick }: any) => <button onClick={onClick}>{title}</button>,
}));
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listTopics: {
        useQuery: () => ({
          data: {
            items: [
              {
                id: 'copy',
                title: '简单问候对话',
                latestMessage: '出个短视频文案吧',
                latestMessageId: 'copy-request',
              },
              { id: 'empty', title: '空话题' },
            ],
          },
          refetch: mocks.refetch,
        }),
      },
    },
  },
}));
beforeEach(() => vi.clearAllMocks());

describe('recent group topics', () => {
  it('hides sidebar dropdowns and children when direct navigation is requested', () => {
    render(<RecentTopicLinks defaultExpanded collapsible={false} groupId="group" />);
    expect(screen.queryByRole('button', { name: /展开话题|收起话题/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '空话题' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'title' }));
    expect(mocks.push).toHaveBeenCalledWith('/group/group/topics');
  });
  it('opens the group topic page from its heading while its arrow only collapses the list', () => {
    render(<RecentTopicLinks defaultExpanded groupId="group" />);
    fireEvent.click(screen.getByRole('button', { name: 'title' }));
    expect(mocks.push).toHaveBeenCalledWith('/group/group/topics');
    expect(screen.getByRole('button', { name: '空话题' })).toBeVisible();
    mocks.push.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '收起话题' }));
    expect(screen.queryByRole('button', { name: '空话题' })).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('displays the latest request and links it to the corresponding timeline location', () => {
    render(<RecentTopicLinks defaultExpanded groupId="group" />);
    expect(screen.queryByText('简单问候对话')).toBeNull();
    expect(screen.getByRole('button', { name: '空话题' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '出个短视频文案吧' }));
    expect(mocks.replace).toHaveBeenCalledWith('/group/group/copy#copy-request');
  });
  it('preserves the selected topic id for the history dialog and joined-group callers', () => {
    const select = vi.fn();
    render(<RecentTopicLinks defaultExpanded groupId="group" onSelectTopic={select} />);
    fireEvent.click(screen.getByRole('button', { name: '出个短视频文案吧' }));
    expect(select).toHaveBeenCalledWith('copy', 'copy-request');
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('can delegate scrolling to the enclosing sidebar', () => {
    render(
      <RecentTopicLinks
        defaultExpanded
        groupId="group"
        scrollWithinSection={false}
      />,
    );

    const preview = document.querySelector<HTMLElement>('[data-group-topic-preview]');
    expect(preview).not.toBeNull();
    expect(preview?.style.overflowY).toBe('');
    expect(preview?.style.maxHeight).toBe('');
  });
});
