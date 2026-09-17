export type {
  CreateGoalParams,
  CreateGoalState,
  GoalCriterionDraft,
} from '@lobechat/builtin-tool-task';

export const GoalApiName = {
  createGoal: 'createGoal',
  viewGoal: 'viewGoal',
  reviseGoal: 'reviseGoal',
  resumeGoal: 'resumeGoal',
} as const;

export type GoalApiNameType = (typeof GoalApiName)[keyof typeof GoalApiName];
