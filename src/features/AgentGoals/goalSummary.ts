import type { GoalStatus } from '@lobechat/types';

export interface GoalSummary {
  delivered: number;
  pursuing: number;
  total: number;
}

/**
 * Overview counters for a goal list.
 *
 * `delivered` counts the successful terminal status only. It used to count `review`,
 * which is not a delivery: a goal in `review` is parked on a person (an open decision
 * gate). With the group's goals ending as `achieved`, every finished goal was reported
 * as "open" while the list below them — filtered by terminal status — showed none of
 * them, so the two halves of the page contradicted each other.
 */
export const summarizeGoals = (goals: Array<{ goal: { status: GoalStatus } }>): GoalSummary => {
  const delivered = goals.filter(({ goal }) => goal.status === 'achieved').length;

  return { delivered, pursuing: goals.length - delivered, total: goals.length };
};
