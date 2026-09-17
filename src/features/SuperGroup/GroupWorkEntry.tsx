'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { ChevronRight, ChevronUp, ListChecks, Target } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import GeneratingBorder from '@/components/GeneratingBorder';
import { useTravelTranslation } from '@/utils/i18n/travel';

import type { GroupWorkKind } from './groupWorkEntries';

export interface GroupWorkStatusItem {
  agentId?: string;
  assigneeLabel: string;
  id: string;
  isRunning: boolean;
  kind: GroupWorkKind;
  rawStatus?: string;
  status: string;
  title: string;
}

const styles = createStaticStyles(({ css, cssVar }) => ({
  frame: css`
    --work-edge-height: 20px;
    --work-edge-inset: 48px;

    position: relative;

    /* Keep this rear surface below the message minimap's overlay (z-index: 1). */
    z-index: 0;

    width: calc(100% - var(--work-edge-inset) * 2);
    height: var(--work-edge-height);
    margin-inline: auto;

    @media (width <= 600px) {
      --work-edge-inset: 16px;
    }

    @media (hover: none) {
      --work-edge-height: 32px;
    }
  `,
  surface: css`
    position: absolute;
    inset-block-end: calc(-1 * var(--work-edge-height));
    inset-inline: 0;

    display: grid;
    grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr);

    box-sizing: border-box;
    width: 100%;
    height: calc(var(--work-edge-height) * 2);
    padding-block-end: var(--work-edge-height);
    border: 0.5px solid ${cssVar.colorBorder};
    border-radius: 12px;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    /* The same surface grows upward, leaving the front composer's border exposed. */
    clip-path: inset(0 0 calc(var(--work-edge-height) + 1px) 0);

    transition: height 200ms cubic-bezier(0.16, 1, 0.3, 1);

    &[data-expanded='true'] {
      height: calc(var(--work-edge-height) + 44px);
      color: ${cssVar.colorText};
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  workSurface: css`
    isolation: isolate;
    position: absolute;
    inset-block-end: calc(-1 * var(--work-edge-height));
    inset-inline: 0;

    box-sizing: border-box;
    padding-block-end: var(--work-edge-height);
    border: 0.5px solid ${cssVar.colorBorder};
    border-radius: 12px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};

    /* Preserve the original rear tab: its lower edge stays behind the composer. */
    clip-path: inset(0 0 calc(var(--work-edge-height) + 1px) 0);
  `,
  workHeader: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);

    /* Match the original 44px border-box reveal, including its two 1px edges. */
    min-height: calc(44px - 2px);
  `,
  status: css`
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextSecondary};

    @media (width <= 600px) {
      display: none;
    }
  `,
  list: css`
    overflow-y: auto;
    overscroll-behavior: contain;

    max-height: min(240px, 35dvh);
    padding-block: 4px;
    padding-inline: 8px;
    border-block-start: 0.5px solid ${cssVar.colorBorderSecondary};
  `,
  item: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    padding: 8px;
    border: 0;
    border-radius: 8px;

    font: inherit;
    color: ${cssVar.colorText};
    text-align: start;

    background: transparent;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    > span {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    small {
      display: block;
      font-size: ${cssVar.fontSizeSM};
      color: ${cssVar.colorTextSecondary};
    }

    svg {
      flex-shrink: 0;
    }
  `,
  borderPaused: css`
    &&::after {
      animation-play-state: paused;
    }
  `,
  action: css`
    && {
      cursor: pointer;

      display: flex;
      gap: 4px;
      align-items: center;
      justify-content: center;

      min-width: 0;
      height: 100%;
      min-height: 0;
      padding-block: 0;
      padding-inline: 4px;
      border: 0;
      border-radius: 0;

      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      line-height: 16px;
      color: inherit;

      background: transparent;
      box-shadow: none;

      transition: font-size 200ms ease-out;

      svg {
        flex-shrink: 0;
        width: 12px;
        height: 12px;
        transition:
          width 200ms ease-out,
          height 200ms ease-out;
      }

      [data-expanded='true'] > & {
        font-size: ${cssVar.fontSize};

        svg {
          width: 16px;
          height: 16px;
        }
      }

      &:focus-visible {
        outline: 2px solid ${cssVar.colorPrimary};
        outline-offset: -3px;
      }

      @media (prefers-reduced-motion: reduce) {
        transition: none;

        svg {
          transition: none;
        }
      }
    }
  `,
}));

export default function GroupWorkEntry({
  disabled,
  onSelect,
  items = [],
  onOpen,
  renderControls,
}: {
  renderControls?: (item: GroupWorkStatusItem) => ReactNode;
  disabled?: boolean;
  items?: GroupWorkStatusItem[];
  onOpen?: (item: GroupWorkStatusItem) => void;
  onSelect: (kind: GroupWorkKind, trigger: HTMLElement) => void;
}) {
  const t = useTravelTranslation();
  const [expanded, setExpanded] = useState(false);
  const edge = useRef<HTMLButtonElement>(null);
  const controlsId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const intersecting = useRef(true);
  const [visible, setVisible] = useState(true);
  const runningCount = items.filter((item) => item.isRunning).length;
  useEffect(() => {
    const update = () => setVisible(intersecting.current && !document.hidden);
    document.addEventListener('visibilitychange', update);
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(([entry]) => {
            intersecting.current = entry.isIntersecting;
            update();
          });
    if (frame.current) observer?.observe(frame.current);
    return () => {
      document.removeEventListener('visibilitychange', update);
      observer?.disconnect();
    };
  }, []);
  return (
    <div
      className={styles.frame}
      ref={frame}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
      onFocus={() => {
        if (!items.length) setExpanded(true);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        edge.current?.focus();
        setExpanded(false);
      }}
      onMouseEnter={() => {
        if (!items.length) setExpanded(true);
      }}
      onMouseLeave={(event) => {
        if (!items.length && !event.currentTarget.contains(document.activeElement))
          setExpanded(false);
      }}
    >
      {items.length > 0 ? (
        <div className={styles.workSurface}>
          <GeneratingBorder
            className={!visible ? styles.borderPaused : undefined}
            generating={runningCount > 0}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: 'inherit',
              pointerEvents: 'none',
            }}
          />
          <div className={styles.workHeader}>
            <Button
              className={styles.action}
              icon={<Target />}
              onClick={(event) => onSelect('goals', event.currentTarget)}
            >
              {t('目标')}（{items.filter((item) => item.kind === 'goals').length}）
            </Button>
            <button
              aria-controls={controlsId}
              aria-expanded={expanded}
              aria-label={t('目标与任务')}
              className={styles.action}
              ref={edge}
              type="button"
              onClick={() => setExpanded(!expanded)}
            >
              <span className={styles.status} role="status">
                {runningCount
                  ? `${t('执行中')}（${runningCount}）`
                  : `${t('待处理')}（${items.length}）`}
              </span>
              <ChevronUp
                aria-hidden
                size={16}
                style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
              />
            </button>
            <Button
              className={styles.action}
              icon={<ListChecks />}
              onClick={(event) => onSelect('tasks', event.currentTarget)}
            >
              {t('任务')}（{items.filter((item) => item.kind === 'tasks').length}）
            </Button>
          </div>
          {expanded && (
            <div className={styles.list} id={controlsId}>
              {items.map((item) => (
                <div key={`${item.kind}:${item.id}`}>
                  <button className={styles.item} type="button" onClick={() => onOpen?.(item)}>
                    {item.kind === 'goals' ? (
                      <Target aria-hidden size={16} />
                    ) : (
                      <ListChecks aria-hidden size={16} />
                    )}
                    <span>
                      {item.title}
                      <small>
                        {item.assigneeLabel} · {t(item.status)}
                      </small>
                    </span>
                    <ChevronRight aria-hidden size={16} />
                  </button>
                  {renderControls && (
                    <div style={{ padding: '0 8px 8px' }}>{renderControls(item)}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={styles.surface} data-expanded={expanded} id={controlsId}>
          <Button
            className={styles.action}
            disabled={disabled}
            icon={<Target />}
            onClick={(event) =>
              expanded ? onSelect('goals', edge.current || event.currentTarget) : setExpanded(true)
            }
          >
            {t('设定一个目标')}
          </Button>
          <button
            aria-controls={controlsId}
            aria-expanded={expanded}
            aria-label={t('目标与任务')}
            className={styles.action}
            ref={edge}
            type="button"
            onClick={() => setExpanded(true)}
          >
            <ChevronUp aria-hidden size={16} />
          </button>
          <Button
            className={styles.action}
            disabled={disabled}
            icon={<ListChecks size={20} />}
            onClick={(event) =>
              expanded ? onSelect('tasks', edge.current || event.currentTarget) : setExpanded(true)
            }
          >
            {t('制定一个任务')}
          </Button>
        </div>
      )}
    </div>
  );
}
