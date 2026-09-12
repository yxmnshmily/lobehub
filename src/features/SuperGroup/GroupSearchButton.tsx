'use client';

import { GROUP_CHAT_URL } from '@lobechat/const';
import { copyToClipboard, Flexbox } from '@lobehub/ui';
import { ActionIcon, Alert, Button, createModal, Input, Text, toast } from '@lobehub/ui/base-ui';
import { escapeRegExp } from 'es-toolkit';
import { Copy, LocateFixed, Search } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import NavItem from '@/features/NavPanel/components/NavItem';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { lambdaClient } from '@/libs/trpc/client';

function SearchResultText({ content, query }: { content: string; query: string }) {
  if (!query) return <span>{content}</span>;

  const parts = content.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return (
    <span>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} style={{ backgroundColor: '#ffeb3b', color: '#000', padding: 0 }}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  );
}

function GroupSearchPanel({
  groupId,
  onSelect,
}: {
  groupId: string;
  onSelect: (url: string) => void;
}) {
  const [keywords, setKeywords] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, isLoading, mutate } = useSWR(
    query ? ['group-message-search', groupId, query] : null,
    () => lambdaClient.message.searchMessages.query({ groupId, keywords: query }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  return (
    <Flexbox gap={12} style={{ minWidth: 0 }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(keywords.trim());
        }}
      >
        <Flexbox horizontal gap={8}>
          <Input
            autoFocus
            aria-label="搜索群内容"
            maxLength={200}
            placeholder="输入关键词，搜索当前群聊天记录"
            style={{ flex: 1, minWidth: 0 }}
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
          />
          <Button disabled={!keywords.trim()} htmlType="submit" loading={isLoading}>
            搜索
          </Button>
        </Flexbox>
      </form>
      <Text type="secondary">仅搜索当前群的聊天记录，可复制结果或跳转聊天位置。</Text>
      {error && (
        <Alert
          action={<Button onClick={() => void mutate()}>重试</Button>}
          title="搜索失败，请重试"
          type="error"
        />
      )}
      <Flexbox aria-live="polite" gap={8} style={{ maxHeight: '50dvh', overflowY: 'auto' }}>
        {isLoading && <Text>正在搜索…</Text>}
        {!error && data?.length === 0 && <Text>没有找到匹配的聊天记录</Text>}
        {!error &&
          data?.map((message) => (
            <Flexbox gap={8} key={message.id} style={{ flexShrink: 0, minWidth: 0 }}>
              <Button
                style={{
                  height: 'auto',
                  justifyContent: 'flex-start',
                  padding: 12,
                  textAlign: 'start',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
                onClick={() =>
                  onSelect(
                    `${GROUP_CHAT_URL(groupId)}${message.topicId ? `/${message.topicId}` : ''}#${encodeURIComponent(message.id)}`,
                  )
                }
              >
                <SearchResultText content={message.content ?? ''} query={query} />
              </Button>
              <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap', paddingBottom: 8 }}>
                <Button
                  icon={Copy}
                  style={{ minHeight: 44 }}
                  onClick={async () => {
                    try {
                      await copyToClipboard(message.content ?? '');
                      toast.success('已复制结果');
                    } catch {
                      toast.error('复制失败，请重试');
                    }
                  }}
                >
                  复制结果
                </Button>
                <Button
                  icon={LocateFixed}
                  style={{ minHeight: 44 }}
                  onClick={() =>
                    onSelect(
                      `${GROUP_CHAT_URL(groupId)}${message.topicId ? `/${message.topicId}` : ''}#${encodeURIComponent(message.id)}`,
                    )
                  }
                >
                  跳转聊天位置
                </Button>
              </Flexbox>
            </Flexbox>
          ))}
      </Flexbox>
    </Flexbox>
  );
}

export default function GroupSearchButton({
  groupId,
  sidebar = false,
}: {
  groupId: string;
  sidebar?: boolean;
}) {
  const router = useQueryRoute();
  const onClick = () => {
    const modal = createModal({
      content: (
        <GroupSearchPanel
          groupId={groupId}
          onSelect={(url) => {
            router.push(url);
            modal.close();
          }}
        />
      ),
      footer: null,
      title: '搜索群内容',
      width: 'min(600px, calc(100vw - 32px))',
    });
  };
  return sidebar ? (
    <NavItem icon={Search} title="搜索群内容" onClick={onClick} />
  ) : (
    <ActionIcon
      aria-label="搜索群内容"
      icon={Search}
      title="搜索群内容"
      tooltipProps={{ placement: 'bottom' }}
      onClick={onClick}
    />
  );
}
