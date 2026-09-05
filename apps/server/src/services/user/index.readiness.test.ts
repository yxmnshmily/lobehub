import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './index';

const mocks = vi.hoisted(() => ({
  buildPlan: vi.fn(),
  checkGroup: vi.fn(),
  getHealth: vi.fn(),
}));

vi.mock('./travelServiceAccount', () => ({ initTravelServiceAccount: vi.fn() }));
vi.mock('./travelServiceGroup', () => ({
  SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES: ['CREATE_DEFAULT_GROUP'],
  buildDefaultTravelServiceGroupRepairPlan: mocks.buildPlan,
  checkDefaultTravelServiceGroup: mocks.checkGroup,
  executeDefaultTravelServiceGroupRepairPlan: vi.fn(),
  getDefaultTravelServiceGroupHealthSummary: mocks.getHealth,
  initDefaultTravelServiceGroup: vi.fn(),
}));
vi.mock('@/business/server/user', () => ({ initNewUserForBusiness: vi.fn() }));
vi.mock('@/libs/analytics', () => ({ initializeServerAnalytics: vi.fn() }));

describe('UserService.checkTravelServiceReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getHealth.mockResolvedValue({ healthy: false });
    mocks.buildPlan.mockReturnValue({
      actions: [{ code: 'CREATE_DEFAULT_GROUP', reviewRequired: false, target: 'group' }],
      reviewRequired: false,
    });
  });

  it('returns the owned group id only when readiness is verified', async () => {
    mocks.checkGroup.mockResolvedValue({ groupId: 'owned-group', ready: true });

    await expect(new UserService({} as any).checkTravelServiceReadiness('user-a')).resolves.toEqual(
      { groupId: 'owned-group', status: 'ready' },
    );
    expect(mocks.getHealth).not.toHaveBeenCalled();
  });

  it('fails closed for blocked accounts without planning a repair', async () => {
    mocks.checkGroup.mockResolvedValue({ accessState: 'banned', groupId: null, ready: false });

    await expect(new UserService({} as any).checkTravelServiceReadiness('user-a')).resolves.toEqual(
      { status: 'review_required' },
    );
    expect(mocks.getHealth).not.toHaveBeenCalled();
  });

  it('separates safe preparation from administrator review', async () => {
    mocks.checkGroup.mockResolvedValue({ accessState: 'active', groupId: null, ready: false });
    const service = new UserService({} as any);

    await expect(service.checkTravelServiceReadiness('user-a')).resolves.toEqual({
      status: 'preparing',
    });

    mocks.buildPlan.mockReturnValue({
      actions: [{ code: 'SUPERVISOR_REVIEW_REQUIRED', reviewRequired: true }],
      reviewRequired: true,
    });
    await expect(service.checkTravelServiceReadiness('user-a')).resolves.toEqual({
      status: 'review_required',
    });
  });
});
