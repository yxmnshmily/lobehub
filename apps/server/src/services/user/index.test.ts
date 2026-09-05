import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './index';

const mocks = vi.hoisted(() => ({
  buildPlan: vi.fn(),
  checkGroup: vi.fn(),
  executePlan: vi.fn(),
  getHealth: vi.fn(),
  initAccount: vi.fn(),
  initGroup: vi.fn(),
}));

vi.mock('./travelServiceAccount', () => ({ initTravelServiceAccount: mocks.initAccount }));
vi.mock('./travelServiceGroup', () => ({
  SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES: ['CREATE_DEFAULT_GROUP', 'SET_PRIVATE'],
  buildDefaultTravelServiceGroupRepairPlan: mocks.buildPlan,
  checkDefaultTravelServiceGroup: mocks.checkGroup,
  executeDefaultTravelServiceGroupRepairPlan: mocks.executePlan,
  getDefaultTravelServiceGroupHealthSummary: mocks.getHealth,
  initDefaultTravelServiceGroup: mocks.initGroup,
}));
vi.mock('@/business/server/user', () => ({ initNewUserForBusiness: vi.fn() }));
vi.mock('@/libs/analytics', () => ({ initializeServerAnalytics: vi.fn() }));

describe('UserService travel service recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHealth.mockResolvedValue({ healthy: false });
    mocks.buildPlan.mockReturnValue({
      actions: [{ code: 'CREATE_DEFAULT_GROUP', reviewRequired: false, target: 'group' }],
      reviewRequired: false,
    });
    mocks.executePlan.mockResolvedValue({ finalHealth: { healthy: true } });
    mocks.initAccount.mockResolvedValue({ balanceFen: 0 });
  });

  it('repairs a missing group once and verifies the recovered state', async () => {
    mocks.checkGroup
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ groupId: 'travel-group', ready: true });

    const result = await new UserService({} as any).ensureTravelServiceReady('user-1');

    expect(mocks.initAccount).toHaveBeenCalledOnce();
    expect(mocks.initAccount).toHaveBeenCalledWith({}, 'user-1');
    expect(mocks.executePlan).toHaveBeenCalledOnce();
    expect(mocks.executePlan).toHaveBeenCalledWith(
      {},
      {
        expectedPlan: {
          actions: [{ code: 'CREATE_DEFAULT_GROUP', reviewRequired: false, target: 'group' }],
          reviewRequired: false,
        },
        targetUserId: 'user-1',
      },
    );
    expect(mocks.checkGroup).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ groupId: 'travel-group', ready: true });
  });

  it('does not rebuild an already-ready group', async () => {
    mocks.checkGroup.mockResolvedValue({ groupId: 'travel-group', ready: true });

    await new UserService({} as any).ensureTravelServiceReady('user-1');

    expect(mocks.initAccount).toHaveBeenCalledOnce();
    expect(mocks.checkGroup).toHaveBeenCalledOnce();
    expect(mocks.initGroup).not.toHaveBeenCalled();
  });

  it('keeps base user initialization successful when group bootstrap fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.initGroup.mockRejectedValueOnce(new Error('temporary group bootstrap failure'));

    await expect(
      new UserService({} as any).initUser({ email: 'new@example.test', id: 'user-1' }),
    ).resolves.toBeUndefined();
    expect(mocks.initAccount).toHaveBeenCalledOnce();
    expect(mocks.initGroup).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith('Failed to init travel service group');
  });

  it('keeps base user initialization successful and skips the group when account setup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.initAccount.mockRejectedValueOnce(new Error('temporary account bootstrap failure'));

    await expect(
      new UserService({} as any).initUser({ email: 'new@example.test', id: 'user-1' }),
    ).resolves.toBeUndefined();
    expect(mocks.initGroup).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Failed to init travel service account');
  });

  it.each(['banned', 'email-unverified', 'missing-user'])(
    'does not run travel initialization for an account in %s state',
    async (accessState) => {
      mocks.checkGroup.mockResolvedValue({ accessState, groupId: 'travel-group', ready: false });

      const result = await new UserService({} as any).ensureTravelServiceReady('user-1');

      expect(result).toEqual({ accessState, groupId: 'travel-group', ready: false });
      expect(mocks.checkGroup).toHaveBeenCalledOnce();
      expect(mocks.initAccount).not.toHaveBeenCalled();
      expect(mocks.initGroup).not.toHaveBeenCalled();
    },
  );

  it('can retry safely after a temporary first-login group failure', async () => {
    mocks.checkGroup
      .mockResolvedValueOnce({ accessState: 'active', ready: false })
      .mockResolvedValueOnce({ accessState: 'active', ready: false })
      .mockResolvedValueOnce({ accessState: 'active', groupId: 'travel-group', ready: true });
    mocks.executePlan
      .mockRejectedValueOnce(new Error('temporary group bootstrap failure'))
      .mockResolvedValueOnce(undefined);
    const service = new UserService({} as any);

    await expect(service.ensureTravelServiceReady('user-1')).rejects.toThrow(
      'temporary group bootstrap failure',
    );
    await expect(service.ensureTravelServiceReady('user-1')).resolves.toEqual({
      accessState: 'active',
      groupId: 'travel-group',
      ready: true,
    });
    expect(mocks.executePlan).toHaveBeenCalledTimes(2);
  });

  it('skips an unverified session and provisions on the first verified login', async () => {
    mocks.checkGroup
      .mockResolvedValueOnce({ accessState: 'email-unverified', ready: false })
      .mockResolvedValueOnce({ accessState: 'active', ready: false })
      .mockResolvedValueOnce({ accessState: 'active', groupId: 'travel-group', ready: true });
    const service = new UserService({} as any);

    await expect(service.ensureTravelServiceReady('user-1')).resolves.toEqual({
      accessState: 'email-unverified',
      ready: false,
    });
    await expect(service.ensureTravelServiceReady('user-1')).resolves.toEqual({
      accessState: 'active',
      groupId: 'travel-group',
      ready: true,
    });
    expect(mocks.initAccount).toHaveBeenCalledOnce();
    expect(mocks.executePlan).toHaveBeenCalledOnce();
  });

  it('performs no writes when the current repair plan requires review', async () => {
    const current = { accessState: 'active', groupId: 'travel-group', ready: false };
    mocks.checkGroup.mockResolvedValue(current);
    mocks.buildPlan.mockReturnValue({
      actions: [{ code: 'SUPERVISOR_REVIEW_REQUIRED', reviewRequired: true, target: 'supervisor' }],
      reviewRequired: true,
    });

    await expect(new UserService({} as any).ensureTravelServiceReady('user-1')).resolves.toEqual(
      current,
    );

    expect(mocks.initAccount).not.toHaveBeenCalled();
    expect(mocks.executePlan).not.toHaveBeenCalled();
    expect(mocks.initGroup).not.toHaveBeenCalled();
  });

  it.each([
    {
      actions: [{ code: 'FUTURE_UNKNOWN_ACTION', reviewRequired: false, target: 'group' }],
      reviewRequired: false,
    },
    {
      actions: [{ code: 'SET_PRIVATE', reviewRequired: true, target: 'group' }],
      reviewRequired: false,
    },
  ])('performs no writes for a login repair plan outside the safe allowlist', async (plan) => {
    const current = { accessState: 'active', groupId: 'travel-group', ready: false };
    mocks.checkGroup.mockResolvedValue(current);
    mocks.buildPlan.mockReturnValue(plan);

    await expect(new UserService({} as any).ensureTravelServiceReady('user-1')).resolves.toEqual(
      current,
    );

    expect(mocks.initAccount).not.toHaveBeenCalled();
    expect(mocks.executePlan).not.toHaveBeenCalled();
    expect(mocks.initGroup).not.toHaveBeenCalled();
  });
});
