'use client';

import { Flexbox } from '@lobehub/ui';
import { Alert, Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { File } from 'lucide-react';

import SkeletonBar from '@/components/Skeleton/Bar';
import { lambdaQuery } from '@/libs/trpc/client';

export default function GroupFilesPanel({ groupId }: { groupId: string }) {
  // Reuse the conversation's authorized attachment projection, including shared AI results.
  const messages = lambdaQuery.groupConversation.listTextMessages.useInfiniteQuery(
    { groupId, limit: 50, order: 'latest' },
    { getNextPageParam: (page) => page.nextCursor, gcTime: 0, retry: false },
  );
  const published = lambdaQuery.groupConversation.listPublishedAssistantMessages.useQuery(
    { groupId },
    { gcTime: 0, retry: false },
  );
  if (messages.isLoading || published.isLoading) return <SkeletonBar height={160} />;
  if (messages.isError || published.isError)
    return (
      <Alert
        title="群文件加载失败"
        type="error"
        action={
          <Button
            onClick={() => {
              void messages.refetch();
              void published.refetch();
            }}
          >
            重试
          </Button>
        }
      />
    );
  const attachments = [
    ...(messages.data?.pages.flatMap((page) => page.items) ?? []),
    ...(published.data ?? []),
  ].flatMap((message) => [
    ...(message.fileList ?? []).map((file) => ({
      id: file.id,
      name: file.name,
      url: file.downloadUrl || file.url,
    })),
    ...(message.imageList ?? []).map((file) => ({
      id: file.id,
      name: file.alt || '图片',
      url: file.url,
    })),
  ]);
  const files = [...new Map(attachments.map((file) => [file.id, file])).values()];
  return (
    <Flexbox
      gap={12}
      style={{ maxHeight: '60dvh', overflowY: 'auto', overscrollBehavior: 'contain' }}
    >
      <span style={{ color: cssVar.colorTextSecondary }}>本群聊天中已共享的文件与图片</span>
      {files.map((file) => (
        <a
          href={file.url}
          key={file.id}
          rel="noopener noreferrer"
          target="_blank"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            minHeight: 44,
            color: cssVar.colorText,
            overflowWrap: 'anywhere',
          }}
        >
          <File size={18} style={{ flexShrink: 0 }} />
          {file.name}
        </a>
      ))}
      {!files.length && (
        <span>{messages.hasNextPage ? '当前记录暂无文件，可继续加载更早记录' : '暂无群文件'}</span>
      )}
      {messages.hasNextPage && (
        <Button loading={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>
          加载更早记录中的文件
        </Button>
      )}
    </Flexbox>
  );
}
