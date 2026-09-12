import type { LobeChatDatabase } from '@lobechat/database';

import {
  AgentOperationModel,
  type HostedGroupSponsoredBudgetLocator,
} from '@/database/models/agentOperation';

export const HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE =
  'HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE' as const;

export class HostedGroupSponsoredBudgetLocatorUnavailableError extends Error {
  readonly code = HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE;

  constructor() {
    super(HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE);
    this.name = 'HostedGroupSponsoredBudgetLocatorUnavailableError';
  }
}

export type HostedGroupSponsoredBudgetLocatorBinding = Pick<
  HostedGroupSponsoredBudgetLocator,
  | 'actorUserId'
  | 'groupId'
  | 'membershipVersion'
  | 'operationId'
  | 'payerUserId'
  | 'policyVersion'
  | 'resourceOwnerUserId'
>;

const LOCATOR_KEYS = [
  'actorUserId',
  'budgetId',
  'budgetLeaseVersion',
  'expiresAt',
  'groupId',
  'membershipVersion',
  'operationId',
  'payerUserId',
  'policyVersion',
  'resourceOwnerUserId',
  'version',
] as const;

const BINDING_KEYS = [
  'actorUserId',
  'groupId',
  'membershipVersion',
  'operationId',
  'payerUserId',
  'policyVersion',
  'resourceOwnerUserId',
] as const;

const unavailable = () => new HostedGroupSponsoredBudgetLocatorUnavailableError();

const isExactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value as object).length === keys.length &&
  Object.keys(value as object).every((key) => keys.includes(key));

const canonicalText = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value) && value.trim() === value;

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const parseBinding = (value: unknown): HostedGroupSponsoredBudgetLocatorBinding | undefined => {
  if (!isExactRecord(value, BINDING_KEYS)) return undefined;
  if (
    !canonicalText(value.actorUserId) ||
    !canonicalText(value.payerUserId) ||
    !canonicalText(value.resourceOwnerUserId) ||
    value.actorUserId === value.resourceOwnerUserId ||
    value.payerUserId !== value.resourceOwnerUserId ||
    !canonicalText(value.groupId) ||
    !canonicalText(value.operationId) ||
    !positiveSafeInteger(value.membershipVersion) ||
    !positiveSafeInteger(value.policyVersion)
  ) {
    return undefined;
  }

  return {
    actorUserId: value.actorUserId,
    groupId: value.groupId,
    membershipVersion: value.membershipVersion,
    operationId: value.operationId,
    payerUserId: value.payerUserId,
    policyVersion: value.policyVersion,
    resourceOwnerUserId: value.resourceOwnerUserId,
  };
};

const parseLocator = (value: unknown, now: Date): HostedGroupSponsoredBudgetLocator | undefined => {
  if (!isExactRecord(value, LOCATOR_KEYS)) return undefined;
  const binding = parseBinding(Object.fromEntries(BINDING_KEYS.map((key) => [key, value[key]])));
  const expiresAt = canonicalText(value.expiresAt) ? Date.parse(value.expiresAt) : Number.NaN;
  if (
    !binding ||
    value.version !== 1 ||
    !canonicalText(value.budgetId) ||
    !positiveSafeInteger(value.budgetLeaseVersion) ||
    !Number.isFinite(expiresAt) ||
    new Date(expiresAt).toISOString() !== value.expiresAt ||
    expiresAt <= now.getTime()
  ) {
    return undefined;
  }

  return Object.freeze({
    ...binding,
    budgetId: value.budgetId,
    budgetLeaseVersion: value.budgetLeaseVersion,
    expiresAt: value.expiresAt,
    version: 1,
  });
};

const assertNow = (now: Date) => {
  if (!Number.isFinite(now.getTime())) throw unavailable();
};

export const persistHostedGroupSponsoredBudgetLocator = async (
  db: LobeChatDatabase,
  value: unknown,
  now = new Date(),
): Promise<HostedGroupSponsoredBudgetLocator> => {
  assertNow(now);
  const locator = parseLocator(value, now);
  if (!locator) throw unavailable();

  try {
    const recorded = await new AgentOperationModel(
      db,
      locator.resourceOwnerUserId,
    ).recordHostedGroupSponsoredBudgetLocator(locator);
    if (!recorded) throw unavailable();
  } catch {
    throw unavailable();
  }

  return locator;
};

export const resolveHostedGroupSponsoredBudgetLocator = async (
  db: LobeChatDatabase,
  expectedValue: unknown,
  now = new Date(),
): Promise<HostedGroupSponsoredBudgetLocator> => {
  assertNow(now);
  const expected = parseBinding(expectedValue);
  if (!expected) throw unavailable();

  let value: unknown;
  try {
    value = await new AgentOperationModel(
      db,
      expected.resourceOwnerUserId,
    ).findHostedGroupSponsoredBudgetLocator(expected.operationId);
  } catch {
    throw unavailable();
  }
  const locator = parseLocator(value, now);
  if (!locator || BINDING_KEYS.some((key) => locator[key] !== expected[key])) {
    throw unavailable();
  }

  return locator;
};
