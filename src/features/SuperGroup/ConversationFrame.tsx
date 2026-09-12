import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';

import { GroupChatPresentation } from './GroupChatPresentation';

const styles = createStaticStyles(({ css }) => ({
  frame: css`
    --conversation-column-width: 1240px;

    @media (width <= 767px) {
      /* The mobile shell already owns the 10px page gutter. */
      --mobile-page-inner-gutter: 0px;
    }

    &:has([data-group-work-page]) > [data-group-chat-header] {
      display: none;
    }
  `,
  header: css`
    display: contents;
  `,
}));

/** One group conversation surface; membership changes the data access, not the layout. */
export default function ConversationFrame({
  children,
  header,
}: {
  children: ReactNode;
  header: ReactNode;
}) {
  return (
    <GroupChatPresentation.Provider value>
      <Flexbox
        data-conversation-frame
        className={styles.frame}
        flex={1}
        height="100%"
        style={{ minHeight: 0, minWidth: 0, overflow: 'hidden', position: 'relative' }}
        width="100%"
      >
        <div data-group-chat-header className={styles.header}>
          {header}
        </div>
        {children}
      </Flexbox>
    </GroupChatPresentation.Provider>
  );
}
