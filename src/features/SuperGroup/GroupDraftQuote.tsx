import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { X } from 'lucide-react';
import { use, useEffect, useState } from 'react';

import type { ChatInputEditor } from '@/features/ChatInput';
import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';

import { GroupChatPresentation } from './GroupChatPresentation';
import { GroupMessageQuote } from './GroupMessageQuote';
import { type MessageQuote, observeMessageQuote, removeMessageQuote } from './messageQuote';

const styles = createStaticStyles(({ css, cssVar }) => ({
  bar: css`
    min-width: 0;
    padding: 8px 12px;
    background: ${cssVar.colorBgContainer};
    border-radius: 12px;
  `,
}));

function DraftQuote() {
  const editor = useConversationStore((s) => s.editor) as ChatInputEditor | null;
  const writable = useConversationStore((s) => s.composerTarget.writable);
  const store = useConversationStoreApi();
  const [quote, setQuote] = useState<MessageQuote>();
  useEffect(() => {
    const lexical = editor?.instance?.getLexicalEditor();
    if (!lexical) {
      setQuote(undefined);
      return;
    }
    return observeMessageQuote(lexical, (next) =>
      setQuote((previous) =>
        previous?.id === next?.id &&
        previous?.name === next?.name &&
        previous?.excerpt === next?.excerpt
          ? previous
          : next,
      ),
    );
  }, [editor]);
  if (!quote) return null;
  return (
    <Flexbox horizontal align="flex-start" aria-label="正在引用" className={styles.bar} gap={8}>
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <GroupMessageQuote key={quote.id} placement="left" quote={quote} />
      </Flexbox>
      <ActionIcon
        aria-label="取消引用"
        disabled={!writable}
        icon={X}
        title="取消引用"
        onClick={() => {
          const state = store.getState();
          const current = state.editor as ChatInputEditor | null;
          const lexical = current?.instance?.getLexicalEditor();
          if (!state.composerTarget.writable || !current || !lexical) return;
          removeMessageQuote(lexical, quote.id);
          state.updateInputMessage(current.getMarkdownContent());
          current.focus();
        }}
      />
    </Flexbox>
  );
}

export default function GroupDraftQuote() {
  return use(GroupChatPresentation) ? <DraftQuote /> : null;
}
