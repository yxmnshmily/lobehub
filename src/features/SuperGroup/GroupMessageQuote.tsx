import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Reply } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import type { ChatInputEditor } from '@/features/ChatInput';
import { resolveMessageDeepLink } from '@/features/Conversation/ChatList/utils/messageDeepLink';
import { useConversationResourceAccess } from '@/features/Conversation/hooks/useConversationResourceAccess';
import {
  dataSelectors,
  useConversationStore,
  useConversationStoreApi,
} from '@/features/Conversation/store';
import { markdownToTxt } from '@/utils/markdownToTxt';

import {
  appendMessageQuote,
  type MessageQuote,
  parseAgentMessageQuote,
  parseMessageQuote,
} from './messageQuote';

const styles = createStaticStyles(({ css, cssVar }) => ({
  status: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
  `,
  quote: css`
    display: -webkit-box;
    overflow: hidden;
    max-width: 100%;
    padding: 4px 12px;
    border: 0;
    border-inline-start: 0.5px solid ${cssVar.colorBorder};
    color: ${cssVar.colorTextSecondary};
    font: inherit;
    font-size: 13px;
    line-height: 1.6;
    text-align: start;
    overflow-wrap: anywhere;
    background: transparent;
    cursor: pointer;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
    &[data-placement='right'] {
      border-inline-start: 0;
      border-inline-end: 0.5px solid ${cssVar.colorBorder};
    }
  `,
  expanded: css`
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: ${cssVar.colorTextSecondary};
    font-size: 13px;
  `,
  expand: css`
    padding: 4px 12px;
    border: 0;
    background: transparent;
    color: ${cssVar.colorTextSecondary};
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
}));

export function GroupSpeakingStatus({ loading }: { loading?: boolean }) {
  return loading ? (
    <span className={styles.status} role="status">
      正在回复…
    </span>
  ) : null;
}

export function GroupMessageQuote({
  quote,
  placement,
}: {
  placement: 'left' | 'right';
  quote: MessageQuote;
}) {
  const store = useConversationStoreApi();
  const location = useLocation();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const original = useConversationStore((s) => {
    const raw = s.dbMessages?.find((message) => message.id === quote.id);
    if (raw) return raw.content;
    for (const item of s.displayMessages) {
      if (item.id === quote.id) return item.content;
      const child = item.children?.find((message) => message.id === quote.id);
      if (child) return child.content;
    }
  });
  return (
    <div style={{ minWidth: 0, maxWidth: '100%' }}>
      <button
        aria-label={`查看引用消息：${quote.name}`}
        className={styles.quote}
        data-placement={placement}
        title={`${quote.name}：${quote.excerpt}`}
        type="button"
        onClick={() => {
          const target = resolveMessageDeepLink(store.getState().displayMessages, {
            id: quote.id,
            navigationKey: 'quote',
          });
          if (!target) {
            toast.info('原消息不在当前记录中，请到历史话题查看');
            return;
          }
          navigate(`${location.pathname}${location.search}#${encodeURIComponent(quote.id)}`, {
            replace: true,
          });
        }}
      >
        {quote.name}：{quote.excerpt}
      </button>
      <button
        aria-expanded={expanded}
        className={styles.expand}
        type="button"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '收起引用' : '展开引用'}
      </button>
      {expanded && (
        <div className={styles.expanded}>
          {original
            ? markdownToTxt(parseMessageQuote(parseAgentMessageQuote(original).content).content)
            : quote.excerpt}
        </div>
      )}
    </div>
  );
}

export function GroupReplyAction({ id, name }: { id: string; name: string }) {
  const store = useConversationStoreApi();
  const enabled = useConversationStore((s) =>
    Boolean(s.editor?.instance && s.composerTarget.writable),
  );
  const { canUseResource } = useConversationResourceAccess();
  if (!enabled || !canUseResource) return null;
  return (
    <ActionIcon
      aria-label={`引用回复 ${name}`}
      icon={Reply}
      size="small"
      title="引用回复"
      onClick={() => {
        const state = store.getState();
        if (!state.composerTarget.writable) return;
        const editor = state.editor as ChatInputEditor | null;
        const lexical = editor?.instance?.getLexicalEditor();
        const item = dataSelectors.getDisplayMessageById(id)(state);
        if (!editor || !lexical || !item) return;
        const block = item.children?.findLast((child) => child.content?.trim());
        const content = item.content?.trim() || block?.content || '[附件消息]';
        appendMessageQuote(lexical, {
          id: block?.id || id,
          name,
          excerpt: markdownToTxt(
            parseMessageQuote(parseAgentMessageQuote(content).content).content,
          ),
        });
        state.updateInputMessage(editor.getMarkdownContent());
        editor.focus();
      }}
    />
  );
}
