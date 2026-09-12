'use client';

import { ChatInput, ChatInputActionBar } from '@lobehub/editor/react';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import ChatInputNotice from '@/features/ChatInput/ChatInputNotice';
import { focusEditorOnBodyClick } from '@/features/ChatInput/components/focusEditorOnBodyClick';
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
    border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
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
    border-block-end: 0.5px solid ${cssVar.colorBorderSecondary};
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

const DesktopChatInput = memo<{
  sendAreaPrefix?: ReactNode;
  leftContent?: ReactNode;
  inputBanner?: ReactNode;
}>(({ sendAreaPrefix, leftContent, inputBanner }) => {
  const { t } = useTranslation('chat');
  const [slashMenuRef, expand] = useChatInputStore((s) => [s.slashMenuRef, s.expand]);
  const leftActions = useChatInputStore((s) => s.leftActions);

  const fileNode = leftActions.flat().includes('fileUpload') && <FilePreview />;

  return (
    <>
      {!expand && fileNode}
      <Flexbox
        className={cx(styles.container, expand && styles.fullscreen)}
        gap={4}
        paddingBlock={'0 4px'}
        paddingInline={12}
      >
        <div
          style={
            inputBanner && !expand ? { position: 'relative', zIndex: 1 } : { display: 'contents' }
          }
        >
          <ChatInput
            className={styles.inputRoot}
            fullscreen={expand}
            maxHeight={160}
            minHeight={64}
            resize={false}
            slashMenuRef={slashMenuRef}
            footer={
              <Flexbox className={styles.footerRow}>
                {sendAreaPrefix && <Flexbox padding={8}>{sendAreaPrefix}</Flexbox>}
                <ChatInputActionBar
                  className={styles.actionRow}
                  right={<SendArea hideContextWindow={false} />}
                />
              </Flexbox>
            }
            header={
              <ChatInputActionBar
                className={cx(styles.actionRow, styles.headerRow)}
                left={
                  <Flexbox horizontal align={'center'} className={styles.leftSlot} gap={4}>
                    {leftContent ?? <ActionBar />}
                    <ChatInputNotice />
                  </Flexbox>
                }
              />
            }
            onBodyClick={focusEditorOnBodyClick}
          >
            {expand && fileNode}
            <div className={styles.editorWrapper}>
              <InputEditor defaultRows={1} />
            </div>
          </ChatInput>
        </div>
        {!expand && inputBanner}
        {!expand && (
          <div
            style={{
              color: cssVar.colorTextSecondary,
              fontSize: 10,
              lineHeight: '14px',
              textAlign: 'center',
            }}
          >
            {t('input.disclaimer')}
          </div>
        )}
      </Flexbox>
    </>
  );
});

DesktopChatInput.displayName = 'DesktopChatInput';

export default DesktopChatInput;
