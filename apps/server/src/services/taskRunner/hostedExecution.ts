import {
  getPlatformManagedExecutionContext,
  type PlatformManagedExecutionContext,
} from '@/server/services/aiAgent/platformManagedExecution';

const TASK_EXECUTION_CONTEXT = Symbol('task-execution-context');

export interface TaskExecutionContext {
  capability: Readonly<PlatformManagedExecutionContext>;
  groupId: string;
}

/** Carry only an existing server capability across tRPC middleware object spreads. */
export const carryTaskExecutionContext = <T extends object>(input: T, source: unknown): T => {
  const capability = getPlatformManagedExecutionContext(source);
  const groupId = (source as { groupId?: unknown } | null)?.groupId;
  if (!capability?.sharedBudget || typeof groupId !== 'string' || !groupId) return input;
  Object.defineProperty(input, TASK_EXECUTION_CONTEXT, {
    enumerable: true,
    value: Object.freeze({ capability, groupId }),
  });
  return input;
};

export const getTaskExecutionContext = (input: unknown): TaskExecutionContext | undefined =>
  input && typeof input === 'object'
    ? (input as { [TASK_EXECUTION_CONTEXT]?: TaskExecutionContext })[TASK_EXECUTION_CONTEXT]
    : undefined;
