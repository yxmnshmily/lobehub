// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE,
  persistHostedGroupSponsoredBudgetLocator,
  resolveHostedGroupSponsoredBudgetLocator,
} from '../hostedGroupSponsoredBudgetLocator';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: class {
    findHostedGroupSponsoredBudgetLocator = mocks.find;
    recordHostedGroupSponsoredBudgetLocator = mocks.record;
  },
}));

const now = new Date('2026-09-04T00:00:00.000Z');
const locator = {
  actorUserId: 'invited-member',
  budgetId: 'sponsored-budget',
  budgetLeaseVersion: 3,
  expiresAt: '2026-09-04T00:15:00.000Z',
  groupId: 'default-private-travel-group',
  membershipVersion: 7,
  operationId: 'hosted-operation',
  payerUserId: 'group-owner',
  policyVersion: 11,
  resourceOwnerUserId: 'group-owner',
  version: 1 as const,
};
const expected = {
  actorUserId: locator.actorUserId,
  groupId: locator.groupId,
  membershipVersion: locator.membershipVersion,
  operationId: locator.operationId,
  payerUserId: locator.payerUserId,
  policyVersion: locator.policyVersion,
  resourceOwnerUserId: locator.resourceOwnerUserId,
};

describe('hosted group sponsored budget locator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(true);
    mocks.find.mockResolvedValue(locator);
  });

  it('persists and resolves only the exact server-owned locator contract', async () => {
    await expect(
      persistHostedGroupSponsoredBudgetLocator({} as any, locator, now),
    ).resolves.toEqual(locator);
    await expect(
      resolveHostedGroupSponsoredBudgetLocator({} as any, expected, now),
    ).resolves.toEqual(locator);

    expect(mocks.record).toHaveBeenCalledWith(locator);
    expect(JSON.stringify(mocks.record.mock.calls[0]?.[0])).not.toContain('runHandle');
    expect(JSON.stringify(mocks.record.mock.calls[0]?.[0])).not.toContain('secret');
  });

  it.each([
    ['actor', { actorUserId: 'another-member' }],
    ['payer', { payerUserId: 'another-payer' }],
    ['owner', { resourceOwnerUserId: 'another-owner' }],
    ['group', { groupId: 'another-group' }],
    ['membership version', { membershipVersion: 8 }],
    ['policy version', { policyVersion: 12 }],
    ['operation', { operationId: 'another-operation' }],
  ])('fails closed when the expected %s does not match', async (_name, change) => {
    await expect(
      resolveHostedGroupSponsoredBudgetLocator({} as any, { ...expected, ...change }, now),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE });
  });

  it('fails closed for expiry, malformed persisted data, or a missing row', async () => {
    mocks.find.mockResolvedValueOnce({
      ...locator,
      expiresAt: '2026-09-03T23:59:59.999Z',
    });
    await expect(
      resolveHostedGroupSponsoredBudgetLocator({} as any, expected, now),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE });

    mocks.find.mockResolvedValueOnce({ ...locator, runHandle: 'must-never-persist' });
    await expect(
      resolveHostedGroupSponsoredBudgetLocator({} as any, expected, now),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE });

    mocks.find.mockResolvedValueOnce(null);
    await expect(
      resolveHostedGroupSponsoredBudgetLocator({} as any, expected, now),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE });
  });

  it.each([
    ['member self-pays', { payerUserId: locator.actorUserId }],
    ['actor owns resources', { actorUserId: locator.resourceOwnerUserId }],
    ['secret-bearing input', { secret: 'do-not-store' }],
    ['raw run handle input', { runHandle: 'do-not-store' }],
  ])('does not persist %s', async (_name, change) => {
    await expect(
      persistHostedGroupSponsoredBudgetLocator({} as any, { ...locator, ...change } as any, now),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('fails closed when the operation row refuses the first-write CAS', async () => {
    mocks.record.mockResolvedValue(false);

    await expect(
      persistHostedGroupSponsoredBudgetLocator({} as any, locator, now),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_SPONSORED_BUDGET_LOCATOR_UNAVAILABLE });
  });
});
