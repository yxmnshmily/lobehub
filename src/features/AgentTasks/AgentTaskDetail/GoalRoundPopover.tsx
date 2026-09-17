'use client';

import { formatLocalizedTokens } from '@lobechat/utils/format';
import { Flexbox, Popover } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ClipboardCheck, Cpu, type LucideIcon, Timer, Wallet } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useMonthlyExchangeRate } from '@/features/CustomerCenter/useMonthlyExchangeRate';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  value: css`
    font-size: 12px;
  `,
}));

/** Cost is fractions of a cent per round — two decimals would read as "$0.00". */
export const formatRoundCost = (cost: number): string =>
  cost > 0 && cost < 0.01 ? `<$0.01` : `$${cost.toFixed(cost < 1 ? 3 : 2)}`;

export const formatTokens = formatLocalizedTokens;

interface GoalRoundPopoverProps {
  children: ReactNode;
  duration: string;
  index: number;
  status?: string | null;
  usage?: { cost: number; tokens: number } | null;
  verdict?: string | null;
}

/**
 * The audit view of one round.
 *
 * A block on the rail can only encode "how long" through its width; what it
 * cost and how it was judged are exactly what an audit needs and exactly what
 * a bar cannot say. Hover carries them without adding a second row of chrome
 * to a component whose whole point is compactness.
 */
const GoalRoundPopover = memo<GoalRoundPopoverProps>(
  ({ children, duration, index, status, usage, verdict }) => {
    const { t } = useTranslation('chat');
    const { format } = useMonthlyExchangeRate();

    const verdictLabel = (() => {
      if (verdict === 'passed' || status === 'passed') return t('taskDetail.runVerify.passed');
      if (verdict === 'failed' || status === 'failed') return t('taskDetail.runVerify.failed');
      if (status === 'errored') return t('taskDetail.runVerify.errored');
      if (status === 'running' || status === 'verifying') return t('taskDetail.runVerify.running');
      if (status) return t('taskDetail.runVerify.pending');
      return undefined;
    })();

    const rows: { icon: LucideIcon; label: string; value: string }[] = [
      { icon: Timer, label: t('taskDetail.goalTimeline.hover.duration'), value: duration },
      // A verdict is the report's own word; `status` is the run's. Both are
      // enum-ish and neither is user-facing copy, so map them rather than
      // leaking a raw `passed` into a Chinese UI.
      ...(verdictLabel
        ? [
            {
              icon: ClipboardCheck,
              label: t('taskDetail.goalTimeline.hover.verdict'),
              value: verdictLabel,
            },
          ]
        : []),
      // Absent for a round that never reported usage (still running, or an
      // older row) — an audit should see nothing rather than a fabricated 0.
      ...(usage?.cost
        ? [
            {
              icon: Wallet,
              label: t('taskDetail.goalTimeline.hover.cost'),
              value: format(usage.cost, 6),
            },
          ]
        : []),
      ...(usage?.tokens
        ? [
            {
              icon: Cpu,
              label: t('taskDetail.goalTimeline.hover.tokens'),
              value: formatTokens(usage.tokens),
            },
          ]
        : []),
    ];

    return (
      <Popover
        arrow={false}
        placement={'top'}
        trigger={'hover'}
        content={
          <Flexbox gap={6} style={{ minWidth: 140 }}>
            <Text fontSize={13} weight={500}>
              {t('taskDetail.goalTimeline.round', { index })}
            </Text>
            {rows.map((row) => (
              <Flexbox
                horizontal
                align={'center'}
                gap={16}
                justify={'space-between'}
                key={row.label}
              >
                <span className={styles.label}>
                  <row.icon aria-hidden size={14} />
                  {row.label}
                </span>
                <span className={styles.value}>{row.value}</span>
              </Flexbox>
            ))}
          </Flexbox>
        }
      >
        {children}
      </Popover>
    );
  },
);

GoalRoundPopover.displayName = 'GoalRoundPopover';

export default GoalRoundPopover;
