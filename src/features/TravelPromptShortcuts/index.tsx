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
    gap: 6px;
    align-items: center;

    padding-inline-end: 4px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
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
  /* 2026-09-18 用户定稿：弹出层宽度按内容自适应（紧凑），不固定 640；
     单条提示词超长时单行省略，悬停条目可看全文（title 提示），点击填入完整内容。 */
  panel: css`
    box-sizing: border-box;
    width: fit-content;
    min-width: 240px;
    max-width: calc(100vw - 32px);
    padding-block: 8px 12px;
    padding-inline: 16px;

    /* 面板带 0.5px 边框线（与全站细线一致）。 */
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: inherit;

    font-weight: 400;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};
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
    display: grid;

    /* 2026-09-18 用户定稿：手机端弹出层也是 2 列一排（去掉 ≤480px 退单列的回退）。 */
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 12px;

    max-height: min(240px, 30dvh);
  `,
  prompt: css`
    position: relative;

    justify-content: space-between;

    width: 100%;
    min-width: 0;
    height: auto;
    min-height: 44px;
    padding-block: 10px;
    padding-inline: 8px;
    border: 0;
    border-radius: 8px;

    text-align: start;

    /* 紧凑布局：单行省略，全文由 title 提示与点击填入承载。 */
    white-space: nowrap;

    &&,
    &&:hover {
      font-weight: 400;
      color: ${cssVar.colorTextSecondary};
    }

    &:nth-child(n + 3)::before {
      pointer-events: none;
      content: '';

      position: absolute;
      inset-block-start: 0;
      inset-inline: 8px;

      border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
    }

    @media (width <= 480px) {
      &:nth-child(2)::before {
        pointer-events: none;
        content: '';

        position: absolute;
        inset-block-start: 0;
        inset-inline: 8px;

        border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
      }
    }
  `,
  /* 紧凑布局：条目单行省略，2 列下随格子收缩；全文悬停 title 可见、点击填入完整内容。 */
  promptTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;

    text-overflow: ellipsis;
    white-space: nowrap;
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
        {category.prompts.map(([title, prompt]) => {
          /* 2026-09-18 用户定稿：条目显示主核心短描述（如"混剪种草文案"），
             不用"文案 1/2/3"序号；短题由 prompts.ts 的映射表提供。 */
          const shortTitle = title;
          return (
            <Button
              className={styles.prompt}
              key={shortTitle}
              title={prompt}
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
              <span className={styles.promptTitle}>{shortTitle}</span>
              <Icon icon={ChevronRight} size={16} />
            </Button>
          );
        })}
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
            placement="top"
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
            open={active === index}
            /* 2026-09-18 用户定稿：带指针箭头指向所点的组；面板带边框线。 */
            arrow
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
