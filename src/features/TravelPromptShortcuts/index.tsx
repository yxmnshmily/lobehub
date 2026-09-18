'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, X } from 'lucide-react';
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import { InputBanner } from '@/features/Home/InputArea/InputBanner';

import { travelPromptBlocks } from './prompts';

const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    position: relative;

    /* 面板绝对定位挂在提示词排上方，不能被输入区裁切。 */
    overflow: visible;
    padding-block: 8px;
  `,
  /* 2026-09-18 用户定稿：6 个组一排小按钮（窄屏横向滚动，不换行）。 */
  root: css`
    scrollbar-width: thin;

    overflow-x: auto;
    display: flex;
    gap: 4px;
    align-items: center;

    width: 100%;
    min-width: 0;
  `,
  category: css`
    flex: none;

    min-height: 32px;
    padding-inline: 8px;
    border: 0;
    border-radius: 8px;

    font-size: ${cssVar.fontSizeSM};
    font-weight: 400;
    color: ${cssVar.colorTextSecondary};

    &&,
    &&:hover,
    &&[aria-expanded='true'] {
      color: ${cssVar.colorTextSecondary};
    }

    @media (pointer: coarse) {
      min-height: 44px;
    }
  `,
  /* 2026-09-18 用户定稿：面板相对整条提示词排水平居中，不随所点按钮偏移；
     箭头单独指向被点击的组。 */
  panelWrap: css`
    position: absolute;
    z-index: 100;
    inset-block-end: calc(100% + 10px);
    inset-inline-start: 50%;
    transform: translateX(-50%);

    width: min(640px, calc(100vw - 32px));
  `,
  arrow: css`
    position: absolute;
    z-index: 101;
    inset-block-end: calc(100% + 6px);
    transform: translateX(-50%) rotate(45deg);

    width: 10px;
    height: 10px;

    background: ${cssVar.colorBgContainer};
  `,
  panel: css`
    box-sizing: border-box;
    padding-block: 8px 12px;
    padding-inline: 16px;
    border-radius: 12px;

    font-weight: 400;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  header: css`
    flex-wrap: nowrap;
    gap: 12px;
    min-width: 0;
  `,
  title: css`
    flex: none;
    white-space: nowrap;
  `,
  list: css`
    scrollbar-width: thin;

    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;

    max-height: min(320px, 40dvh);
  `,
  prompt: css`
    position: relative;

    width: 100%;
    min-width: 0;
    height: auto;
    padding-block: 10px;
    padding-inline: 8px;

    text-align: start;
    white-space: normal;

    &::before {
      pointer-events: none;
      content: '';

      position: absolute;
      inset-block-start: 0;
      inset-inline: 8px;

      border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
    }

    &&,
    &&:hover {
      font-weight: 400;
      color: ${cssVar.colorTextSecondary};
    }

    &:first-child::before {
      display: none;
    }
  `,
  promptText: css`
    flex: 1;
    min-width: 0;
    margin-inline-end: 8px;
  `,
  hint: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export default function TravelPromptShortcuts() {
  const blocks = travelPromptBlocks;
  const [active, setActive] = useState<number | null>(null);
  const [arrowLeft, setArrowLeft] = useState(0);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const categoryButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const fillInputMessage = useConversationStore((s) => s.fillInputMessage);
  const store = useConversationStoreApi();
  const previewRef = useRef<string | null>(null);
  const draftRef = useRef<{ text: string; json?: Record<string, any> } | null>(null);

  const restorePreview = useCallback(() => {
    const preview = previewRef.current;
    previewRef.current = null;
    const draft = draftRef.current;
    draftRef.current = null;
    const state = store.getState();
    if (
      preview !== null &&
      draft &&
      (state.inputMessage.trim() === preview.trim() || state.inputMessage === draft.text)
    ) {
      if (draft.json) state.editor?.setDocument('json', draft.json, { keepHistory: true });
      else state.editor?.setDocument('text', draft.text, { keepHistory: true });
      state.updateInputMessage(draft.text);
    }
  }, [store]);

  useEffect(() => {
    if (active === null) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        panelRef.current?.contains(target) ||
        categoryButtons.current.some((button) => button?.contains(target))
      )
        return;
      restorePreview();
      setActive(null);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [active, restorePreview]);

  useEffect(
    () => () => {
      const state = store.getState();
      const draft = draftRef.current;
      if (
        previewRef.current !== null &&
        draft &&
        state.inputMessage.trim() === previewRef.current.trim()
      ) {
        if (draft.json) state.editor?.setDocument('json', draft.json, { keepHistory: true });
        else state.editor?.setDocument('text', draft.text, { keepHistory: true });
        state.updateInputMessage(draft.text);
      }
    },
    [store],
  );

  const block = active === null ? undefined : blocks[active];

  const close = () => {
    restorePreview();
    if (active !== null) categoryButtons.current[active]?.focus();
    setActive(null);
  };

  /* 面板居中于整条提示词排；箭头定位到被点击组的按钮中心。 */
  const toggleBlock = (index: number) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rootRect = rootRef.current?.getBoundingClientRect();
    const btnRect = event.currentTarget.getBoundingClientRect();
    if (rootRect && btnRect) setArrowLeft(btnRect.left + btnRect.width / 2 - rootRect.left);
    if (active === index) {
      restorePreview();
      setActive(null);
      return;
    }
    if (active !== null) restorePreview();
    setActive(index);
  };

  const panel = block && (
    <Flexbox
      aria-label={`${block.title}提示词`}
      className={styles.panel}
      id={panelId}
      ref={panelRef}
      role={'region'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
    >
      <Flexbox horizontal align={'center'} className={styles.header}>
        <Flexbox horizontal align={'center'} className={styles.title} gap={8}>
          <Icon icon={block.icon} size={16} />
          <span>{block.title}</span>
        </Flexbox>
        <span className={styles.hint} title="鼠标移上预览，移开恢复草稿；点击选用，可修改后发送。">
          鼠标移上预览，移开恢复草稿；点击选用，可修改后发送。
        </span>
        <ActionIcon
          aria-label={'关闭提示词'}
          icon={X}
          size={{ blockSize: 44, size: 18 }}
          onClick={close}
        />
      </Flexbox>
      <div className={styles.list} key={block.title}>
        {block.prompts.map((prompt) => (
          <Button
            className={styles.prompt}
            key={prompt}
            type={'text'}
            onMouseLeave={restorePreview}
            onClick={() => {
              previewRef.current = null;
              draftRef.current = null;
              setActive(null);
              fillInputMessage(prompt);
            }}
            onMouseEnter={() => {
              const state = store.getState();
              if (!draftRef.current)
                draftRef.current = {
                  text: state.inputMessage,
                  json: state.editor?.getJSONState(),
                };
              previewRef.current = prompt;
              state.editor?.setDocument('text', prompt, { keepHistory: true });
              state.updateInputMessage(prompt);
            }}
          >
            <span className={styles.promptText}>{prompt}</span>
            <Icon icon={ChevronRight} size={16} />
          </Button>
        ))}
      </div>
    </Flexbox>
  );

  return (
    <InputBanner className={styles.banner} testId="travel-prompt-banner">
      <div
        className={styles.root}
        ref={rootRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        {blocks.map((item, index) => (
          <Button
            aria-controls={active === index ? panelId : undefined}
            aria-expanded={active === index}
            className={styles.category}
            icon={<Icon icon={item.icon} size={16} />}
            key={item.slug}
            ref={(node) => {
              categoryButtons.current[index] = node;
            }}
            onClick={toggleBlock(index)}
          >
            {item.title}
          </Button>
        ))}
      </div>
      {block && (
        <>
          <div className={styles.arrow} style={{ left: arrowLeft }} />
          <div className={styles.panelWrap}>{panel}</div>
        </>
      )}
    </InputBanner>
  );
}
