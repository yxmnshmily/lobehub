import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { type LobeChatDatabase } from '@lobechat/database';

import { initNewUserForBusiness } from '@/business/server/user';
import { UserModel } from '@/database/models/user';
import { initializeServerAnalytics } from '@/libs/analytics';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { FileS3 } from '@/server/modules/S3';

import { grantRegistrationCredits } from './registrationCredits';
import { initTravelServiceAccount } from './travelServiceAccount';
import {
  backfillDefaultTravelGroupSupervisorProfile,
  buildDefaultTravelServiceGroupRepairPlan,
  checkDefaultTravelServiceGroup,
  executeDefaultTravelServiceGroupRepairPlan,
  getDefaultTravelServiceGroupHealthSummary,
  initDefaultTravelServiceGroup,
  SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES,
} from './travelServiceGroup';

const safeTravelGroupRepairActionCodes = new Set<string>(
  SAFE_DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES,
);

type CreatedUser = {
  createdAt?: Date | null;
  email?: string | null;
  firstName?: string | null;
  id: string;
  lastName?: string | null;
  phone?: string | null;
  username?: string | null;
};

export type MyTravelGroupReadiness =
  | { status: 'preparing' }
  | { status: 'retryable_error' }
  | { status: 'review_required' }
  | { groupId: string; status: 'ready' };

export class UserService {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  async initUser(user: CreatedUser) {
    await grantRegistrationCredits(this.db, user.id);
    let travelAccountReady = false;
    try {
      await initTravelServiceAccount(this.db, user.id);
      travelAccountReady = true;
    } catch {
      console.error('Failed to init travel service account');
    }
    if (travelAccountReady) {
      try {
        await initDefaultTravelServiceGroup(this.db, user.id);
      } catch {
        console.error('Failed to init travel service group');
      }
    }

    if (ENABLE_BUSINESS_FEATURES) {
      try {
        await initNewUserForBusiness(user.id, user.createdAt);
      } catch (error) {
        console.error(error);
        console.error('Failed to init new user for business');
      }
    }

    const analytics = await initializeServerAnalytics();
    analytics?.identify(user.id, {
      email: user.email ?? undefined,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      phone: user.phone ?? undefined,
      username: user.username ?? undefined,
    });
    analytics?.track({
      name: 'user_register_completed',
      properties: {
        spm: 'user_service.init_user.user_created',
      },
      userId: user.id,
    });
  }

  async ensureTravelServiceReady(userId: string) {
    await grantRegistrationCredits(this.db, userId);
    const current = await checkDefaultTravelServiceGroup(this.db, userId);
    if (current.accessState && current.accessState !== 'active') return current;

    if (current.ready) {
      if (current.groupId) {
        await backfillDefaultTravelGroupSupervisorProfile(this.db, userId, current.groupId);
      }
      await initTravelServiceAccount(this.db, userId);
      return current;
    }

    const expectedPlan = buildDefaultTravelServiceGroupRepairPlan(
      await getDefaultTravelServiceGroupHealthSummary(this.db, { targetUserId: userId }),
    );
    if (
      expectedPlan.reviewRequired ||
      expectedPlan.actions.some(
        ({ code, reviewRequired }) => reviewRequired || !safeTravelGroupRepairActionCodes.has(code),
      )
    ) {
      return current;
    }

    await initTravelServiceAccount(this.db, userId);
    await executeDefaultTravelServiceGroupRepairPlan(this.db, {
      expectedPlan,
      targetUserId: userId,
    });
    return checkDefaultTravelServiceGroup(this.db, userId);
  }

  async checkTravelServiceReadiness(userId: string): Promise<MyTravelGroupReadiness> {
    const current = await checkDefaultTravelServiceGroup(this.db, userId);
    if (current.ready && current.groupId) return { groupId: current.groupId, status: 'ready' };
    if (current.accessState && current.accessState !== 'active')
      return { status: 'review_required' };

    const plan = buildDefaultTravelServiceGroupRepairPlan(
      await getDefaultTravelServiceGroupHealthSummary(this.db, { targetUserId: userId }),
    );
    if (
      plan.reviewRequired ||
      plan.actions.some(
        ({ code, reviewRequired }) => reviewRequired || !safeTravelGroupRepairActionCodes.has(code),
      )
    ) {
      return { status: 'review_required' };
    }

    return { status: 'preparing' };
  }

  getUserApiKeys = async (id: string) => {
    return UserModel.getUserApiKeys(this.db, id, KeyVaultsGateKeeper.getUserKeyVaults);
  };

  getUserAvatar = async (id: string, image: string) => {
    const s3 = new FileS3();
    const s3FileUrl = `user/avatar/${id}/${image}`;

    try {
      const file = await s3.getFileByteArray(s3FileUrl);
      if (!file) {
        return null;
      }
      return Buffer.from(file);
    } catch (error) {
      console.error('Failed to get user avatar', error);
    }
  };
}
