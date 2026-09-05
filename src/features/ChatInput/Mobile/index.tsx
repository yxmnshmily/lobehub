'use client';

import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, type ReactNode } from 'react';

import ChatInputNotice from '@/features/ChatInput/ChatInputNotice';
import { useChatInputStore } from '@/features/ChatInput/store';
import dynamic from '@/libs/next/dynamic';

import ActionBar from '../ActionBar';
import InputEditor from '../InputEditor';
import SendArea from '../SendArea';

const FilePreview = dynamic(() => import('./FilePreview'), { ssr: false });

const styles = createStaticStyles(({ css }) => ({
  actionRow: css`
    min-height: 52px;
    padding-block: 4px;
    padding-inline: 8px;
    background: ${cssVar.colorFillQuaternary};
  `,
  container: css``,
  editorWrapper: css`
    display: block;
    min-width: 0;
  `,
  footerRow: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  fullscreen: css`
    position: absolute;
    z-index: 100;
    inset: 0;

    width: 100%;
    height: 100%;
    padding: 12px;

    background: ${cssVar.colorBgLayout};
  `,
  leftSlot: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  headerRow: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  inputRoot: css`
    overflow: hidden;

    border-color: ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};

    transition:
      border-color 160ms ease,
      box-shadow 160ms ease;

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }

    [data-placeholder]::after {
      color: ${cssVar.colorTextSecondary};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
}));

const DesktopChatInput = memo<{ sendAreaPrefix?: ReactNode }>(({ sendAreaPrefix }) => {
  const [slashMenuRef, expand] = useChatInputStore((s) => [s.slashMenuRef, s.expand]);
  const leftActions = useChatInputStore((s) => s.leftActions);

  const fileNode = leftActions.flat().includes('fileUpload') && <FilePreview />;

  return (
    <>
      {!expand && fileNode}
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        gap={8}
        paddingBlock={'0 12px'}
        paddingInline={12}
      >
        <ChatInput
          className={styles.inputRoot}
          fullscreen={expand}
          maxHeight={160}
          minHeight={64}
          resize={false}
          slashMenuRef={slashMenuRef}
          footer={
            <ChatInputActionBar
              className={cx(styles.actionRow, styles.footerRow)}
              left={sendAreaPrefix || <div />}
              right={<SendArea hideContextWindow={false} />}
            />
          }
          header={
            <ChatInputActionBar
              className={cx(styles.actionRow, styles.headerRow)}
              left={
                <Flexbox horizontal align={'center'} className={styles.leftSlot} gap={4}>
                  <ActionBar />
                  <ChatInputNotice />
                </Flexbox>
              }
            />
          }
        >
          {expand && fileNode}
          <div className={styles.editorWrapper}>
            <InputEditor defaultRows={1} />
          </div>
        </ChatInput>
      </Flexbox>
    </>
  );
});

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
