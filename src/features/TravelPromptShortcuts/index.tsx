'use client';

import { Flexbox, Icon, Popover } from '@lobehub/ui';
import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, MessageSquareText, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation/store';
import { InputBanner } from '@/features/Home/InputArea/InputBanner';

import { getTravelPromptTriggers } from './prompts';

const styles = createStaticStyles(({ css, cssVar }) => ({
  banner: css`
    padding-block: 48px 8px;
  `,
  label: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    padding-inline-end: 4px;
    color: ${cssVar.colorTextSecondary};
    font-size: ${cssVar.fontSizeSM};
    white-space: nowrap;
  `,
  root: css`
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    width: 100%;
    overflow-x: auto;
    scrollbar-width: thin;
  `,
  category: css`
    flex: none;
    min-height: 32px;
    padding-inline: 8px;
    font-size: ${cssVar.fontSizeSM};
    font-weight: 400;
    color: ${cssVar.colorTextSecondary};
    border: 0;
    border-radius: 8px;

    &&,
    &&:hover,
    &&[aria-expanded='true'] {
      color: ${cssVar.colorTextSecondary};
    }

    @media (pointer: coarse) {
      min-height: 44px;
    }
  `,
  panel: css`
    box-sizing: border-box;
    width: min(640px, calc(100vw - 32px));
    padding: 8px 16px 12px;
    color: ${cssVar.colorTextSecondary};
    font-weight: 400;
    background: ${cssVar.colorBgContainer};
    border-radius: inherit;
  `,
  header: css`
    gap: 12px;
    min-width: 0;
    flex-wrap: nowrap;
  `,
  title: css`
    flex: none;
    white-space: nowrap;
  `,
  list: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    max-height: min(240px, 30dvh);
    scrollbar-width: thin;
    @media (max-width: 480px) {
      grid-template-columns: minmax(0, 1fr);
    }
  `,
  prompt: css`
    position: relative;
    justify-content: space-between;
    min-width: 0;
    width: 100%;
    height: auto;
    min-height: 44px;
    padding: 10px 8px;
    text-align: left;
    white-space: normal;
    border: 0;
    border-radius: 8px;

    &&,
    &&:hover {
      color: ${cssVar.colorTextSecondary};
      font-weight: 400;
    }

    &:nth-child(n + 3)::before {
      content: '';
      position: absolute;
      top: 0;
      inset-inline: 8px;
      border-top: 0.5px solid ${cssVar.colorBorderSecondary};
      pointer-events: none;
    }

    @media (max-width: 480px) {
      &:nth-child(2)::before {
        content: '';
        position: absolute;
        top: 0;
        inset-inline: 8px;
        border-top: 0.5px solid ${cssVar.colorBorderSecondary};
        pointer-events: none;
      }
    }
  `,
  hint: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
  `,
}));

export default function TravelPromptShortcuts({ copyCategory }: { copyCategory?: string } = {}) {
  const triggers = getTravelPromptTriggers(copyCategory);
  const [active, setActive] = useState<number | null>(null);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const categoryButtons = useRef<Array<HTMLButtonElement | HTMLAnchorElement | null>>([]);
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
  const category = active === null ? undefined : triggers[active];

  const close = () => {
    restorePreview();
    if (active !== null) categoryButtons.current[active]?.focus();
    setActive(null);
  };

  const panel = category && (
    <Flexbox
      aria-label={`${category.title}提示词`}
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
          <Icon icon={category.icon} size={16} />
          <span>{category.title}</span>
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
      <div className={styles.list} key={category.title}>
        {category.prompts.map(([title, prompt]) => (
          <Button
            className={styles.prompt}
            key={title}
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
            <span>{title}</span>
            <Icon icon={ChevronRight} size={16} />
          </Button>
        ))}
      </div>
    </Flexbox>
  );

  if (triggers.length === 0) return null;

  return (
    <InputBanner className={styles.banner} testId="travel-prompt-banner">
      <div
        className={styles.root}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        <span className={styles.label}>
          <Icon icon={MessageSquareText} size={16} />
          快速提示词：
        </span>
        {triggers.map((item, index) => (
          <Popover
            nativeButton
            content={active === index ? panel : <span />}
            key={item.title}
            open={active === index}
            placement="topLeft"
            trigger="click"
            styles={{
              content: {
                padding: 0,
                maxWidth: 'calc(100vw - 32px)',
                borderRadius: 12,
                overflow: 'hidden',
              },
            }}
            onOpenChange={(open) => {
              restorePreview();
              setActive((current) => (open ? index : current === index ? null : current));
            }}
          >
            <Button
              aria-controls={active === index ? panelId : undefined}
              aria-expanded={active === index}
              className={styles.category}
              icon={<Icon icon={item.icon} size={16} />}
              type={active === index ? 'default' : 'text'}
              ref={(node) => {
                categoryButtons.current[index] = node;
              }}
            >
              {item.title}
            </Button>
          </Popover>
        ))}
      </div>
    </InputBanner>
  );
}
