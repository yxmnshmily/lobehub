import type { PlatformUsageSharedBudgetHandle } from '@/server/services/platformUsageBilling/sharedBudget';

const PLATFORM_MANAGED_EXECUTION_CAPABILITY = Symbol('platform-managed-execution-capability');

export interface PlatformManagedExecutionContext {
  /** Server-derived authenticated actor. Never accepted from tRPC/browser input. */
  actorUserId?: string;
  maxCredits?: number;
  /** Server-derived owner whose agents, messages and group resources are used. */
  resourceOwnerUserId?: string;
  /** Opaque in-process request budget. Its state is held only behind a private Symbol/WeakMap. */
  sharedBudget?: PlatformUsageSharedBudgetHandle;
}

type PlatformManagedExecutionCapable = {
  [PLATFORM_MANAGED_EXECUTION_CAPABILITY]?: Readonly<PlatformManagedExecutionContext>;
};

/**
 * Grants a platform-managed execution capability to an in-process server call.
 * Symbol keys cannot cross JSON/tRPC/browser boundaries and carry no credential owner identity.
 */
export const grantPlatformManagedExecution = <T extends object>(
  input: T,
  context: PlatformManagedExecutionContext = {},
): T & PlatformManagedExecutionCapable => {
  if (
    context.maxCredits !== undefined &&
    (!Number.isSafeInteger(context.maxCredits) || context.maxCredits <= 0)
  ) {
    throw new TypeError('maxCredits must be a positive safe integer');
  }
  const hasActorIdentity = context.actorUserId !== undefined;
  const hasResourceOwnerIdentity = context.resourceOwnerUserId !== undefined;
  if (hasActorIdentity !== hasResourceOwnerIdentity) {
    throw new TypeError('actorUserId and resourceOwnerUserId must be provided together');
  }
  if (hasActorIdentity && (!context.actorUserId?.trim() || !context.resourceOwnerUserId?.trim())) {
    throw new TypeError('actorUserId and resourceOwnerUserId must be non-empty');
  }
  Object.defineProperty(input, PLATFORM_MANAGED_EXECUTION_CAPABILITY, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({ ...context }),
    writable: false,
  });

  return input;
};

export const hasPlatformManagedExecutionCapability = (input: unknown): boolean =>
  getPlatformManagedExecutionContext(input) !== undefined;

export const getPlatformManagedExecutionContext = (
  input: unknown,
): Readonly<PlatformManagedExecutionContext> | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  return (input as PlatformManagedExecutionCapable)[PLATFORM_MANAGED_EXECUTION_CAPABILITY];
};
