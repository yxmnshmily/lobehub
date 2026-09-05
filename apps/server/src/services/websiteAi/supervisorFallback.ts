import type { OperationToolDispatchPolicy } from '@lobechat/types';

export const WEBSITE_AI_SETTLEMENT_GATED_TEXT = 'settlement-gated-text' as const;

const DISPATCH_KEYS = new Set(['mode', 'route']);
const ROUTE_KEYS = new Set(['disposition', 'intents', 'memberIds', 'mode', 'reason']);

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const exactKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>) =>
  Object.keys(value).every((key) => allowed.has(key));

/**
 * Fail-closed compatibility boundary for the orchestration fallback contract.
 * Both the current `reason` and the additive `disposition` field are accepted,
 * but every supplied classifier must independently authorize safe information.
 */
export const resolveWebsiteAiSupervisorFallback = (dispatch: unknown) => {
  const value = record(dispatch);
  if (!value || !exactKeys(value, DISPATCH_KEYS) || value.mode !== 'supervisor-fallback') {
    return undefined;
  }
  const route = record(value.route);
  if (
    !route ||
    !exactKeys(route, ROUTE_KEYS) ||
    route.mode !== 'supervisor-fallback' ||
    !Array.isArray(route.intents) ||
    route.intents.length !== 0 ||
    !Array.isArray(route.memberIds) ||
    route.memberIds.length !== 0
  ) {
    return undefined;
  }

  const classifiers = [route.reason, route.disposition].filter(
    (candidate) => candidate !== undefined,
  );
  if (
    classifiers.length === 0 ||
    classifiers.some((candidate) => candidate !== 'safe-informational')
  ) {
    return undefined;
  }

  const toolDispatchPolicy: OperationToolDispatchPolicy = {
    cursor: 0,
    finishAfterSteps: true,
    steps: [],
    version: 1,
  };
  return {
    responseDelivery: WEBSITE_AI_SETTLEMENT_GATED_TEXT,
    toolDispatchPolicy,
  } as const;
};
