import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import GroupFilesPanel from './GroupFilesPanel';

const next = vi.hoisted(() => vi.fn());
vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: {
    groupConversation: {
      listTextMessages: {
        useInfiniteQuery: () => ({
          data: {
            pages: [
              {
                items: [{ fileList: [{ id: 'f', name: '群行程.pdf', url: '/api/proxy/file/f' }] }],
              },
            ],
          },
          hasNextPage: true,
          fetchNextPage: next,
        }),
      },
      listPublishedAssistantMessages: {
        useQuery: () => ({
          data: [
            {
              fileList: [{ id: 'f', name: '群行程.pdf', url: '/api/proxy/file/f' }],
              imageList: [{ id: 'i', alt: '群海报', url: '/api/proxy/file/i' }],
            },
          ],
        }),
      },
    },
  },
}));

it('merges shared message and published attachments without duplicates and offers older records', () => {
  render(<GroupFilesPanel groupId="g" />);
  expect(screen.getAllByRole('link', { name: '群行程.pdf' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: '群海报' })).toHaveAttribute('href', '/api/proxy/file/i');
  fireEvent.click(screen.getByRole('button', { name: '加载更早记录中的文件' }));
  expect(next).toHaveBeenCalledOnce();
});
