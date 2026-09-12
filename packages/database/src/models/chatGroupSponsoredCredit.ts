import { createHash } from 'node:crypto';

import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';

import { chatGroups } from '../schemas/chatGroup';
import {
  type ChatGroupSponsoredCreditAuditAction,
  chatGroupSponsoredCreditAudits,
  chatGroupSponsoredCreditPolicies,
  type ChatGroupSponsoredCreditPolicyItem,
} from '../schemas/chatGroupSponsoredCredit';
import { chatGroupUserMemberships } from '../schemas/chatGroupUserMembership';
import {
  platformCreditAccounts,
  platformCreditBudgets,
  type PlatformCreditReservationCallKind,
  type PlatformCreditReservationItem,
  platformCreditReservations,
} from '../schemas/platformCredit';
import { users } from '../schemas/user';
import { workspaces } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';
import { CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT } from './chatGroupUserMembership';
import {
  PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT,
  PLATFORM_CREDIT_INSUFFICIENT_BALANCE,
  PLATFORM_CREDIT_RESERVATION_INVALID_STATE,
  PLATFORM_CREDIT_RESERVATION_STALE_LEASE,
  PlatformCreditModel,
} from './platformCredit';

export const CHAT_GROUP_SPONSORED_CREDIT_CLAIM_DENIED = 'authorization_unavailable';
export const CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN = 'CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN';
export const CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT =
  'CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT';
export const CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED =
  'CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED';
export const CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED =
  'CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED';
export const CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT =
  'CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT';
export const CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED =
  'CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED';
export const CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED =
  'CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED';
export const CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN =
  'CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN';

const MAX_PERIOD_DURATION_SECONDS = 31_536_000;
const MAX_TEXT_LENGTH = 500;
const DEFAULT_TRAVEL_GROUP_CLIENT_ID = 'default-travel-service-group';

const assertPositiveCredits = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
  }
};

const assertExpectedVersion = (value: number, allowZero = false) => {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
  }
};

const assertPeriodDuration = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PERIOD_DURATION_SECONDS) {
    throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
  }
};

const normalizeRequiredText = (value: string, field: string, maxLength = MAX_TEXT_LENGTH) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field}无效`);
  }
  return normalized;
};

const normalizeExpiry = (value: Date) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
  }
  return value;
};

const normalizeLeaseVersion = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
  }
  return value;
};

const sponsoredCallKinds = new Set<PlatformCreditReservationCallKind>([
  'call_llm',
  'compress_context',
  'image',
]);

const normalizeCallKind = (value: PlatformCreditReservationCallKind) => {
  if (!sponsoredCallKinds.has(value)) {
    throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
  }
  return value;
};

export interface ReserveSponsoredPlatformCreditBudgetInput {
  authorizedCredits: number;
  chatGroupId: string;
  expectedMembershipVersion: number;
  expectedPolicyVersion: number;
  expiresAt: Date;
  idempotencyKey: string;
  requestHash: string;
  sourceId: string;
  sourceType: string;
}

export interface ReserveSponsoredRemainingCallInput {
  budgetId: string;
  budgetLeaseVersion: number;
  callKind: PlatformCreditReservationCallKind;
  expiresAt: Date;
  generationId: string;
  generationType?: string | null;
  idempotencyKey: string;
  model: string;
  provider: string;
  requestHash: string;
}

export interface ClaimSponsoredReservationForProviderInput {
  leaseVersion: number;
  reservationId: string;
}

export interface ClaimSponsoredReservationForProviderResult {
  denial?: typeof CHAT_GROUP_SPONSORED_CREDIT_CLAIM_DENIED;
  reservation: PlatformCreditReservationItem;
  shouldCallProvider: boolean;
}

type Database = LobeChatDatabase;

export class ChatGroupSponsoredCreditModel {
  constructor(
    private readonly db: Database,
    private readonly actorUserId: string,
  ) {}

  private getGroup = async (chatGroupId: string, db: Database, ownerOnly: boolean) => {
    const [group] = await db
      .select({
        clientId: chatGroups.clientId,
        id: chatGroups.id,
        ownerUserId: chatGroups.userId,
        visibility: chatGroups.visibility,
        workspaceId: chatGroups.workspaceId,
      })
      .from(chatGroups)
      .where(eq(chatGroups.id, chatGroupId))
      .for('update');

    if (!group || (ownerOnly && group.ownerUserId !== this.actorUserId)) {
      throw new Error(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
    }
    return group;
  };

  private assertPrincipalsAvailable = async (
    params: { memberUserId?: string; ownerUserId: string; workspaceId: string | null },
    db: Database,
  ) => {
    const principalIds = params.memberUserId
      ? [params.ownerUserId, params.memberUserId]
      : [params.ownerUserId];
    const principals = await Promise.all(
      principalIds.map(async (id) => {
        const [principal] = await db
          .select({ banned: users.banned, id: users.id })
          .from(users)
          .where(eq(users.id, id))
          .limit(1);
        return principal;
      }),
    );
    if (principals.some((principal) => !principal || principal.banned === true)) {
      throw new Error(CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED);
    }

    if (params.workspaceId) {
      const [workspace] = await db
        .select({ frozen: workspaces.frozen })
        .from(workspaces)
        .where(eq(workspaces.id, params.workspaceId))
        .limit(1);
      if (!workspace || workspace.frozen === true) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN);
      }
    }
  };

  private insertAudit = async (
    db: Database,
    values: {
      action: ChatGroupSponsoredCreditAuditAction;
      chatGroupId: string;
      enabled?: boolean | null;
      groupPeriodLimitCredits?: number | null;
      memberPeriodLimitCredits?: number | null;
      memberRequestLimitCredits?: number | null;
      membershipVersion?: number | null;
      payerUserId: string;
      policyVersion?: number | null;
      targetUserId?: string | null;
    },
  ) => {
    await db.insert(chatGroupSponsoredCreditAudits).values({
      action: values.action,
      actorUserIdSnapshot: this.actorUserId,
      chatGroupIdSnapshot: values.chatGroupId,
      enabled: values.enabled,
      groupPeriodLimitCredits: values.groupPeriodLimitCredits,
      memberPeriodLimitCredits: values.memberPeriodLimitCredits,
      memberRequestLimitCredits: values.memberRequestLimitCredits,
      membershipVersion: values.membershipVersion,
      payerUserIdSnapshot: values.payerUserId,
      policyVersion: values.policyVersion,
      targetUserIdSnapshot: values.targetUserId,
    });
  };

  getPolicy = async (chatGroupId: string) => {
    await this.getGroup(chatGroupId, this.db, true);
    const [policy] = await this.db
      .select()
      .from(chatGroupSponsoredCreditPolicies)
      .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, chatGroupId))
      .limit(1);
    return policy;
  };

  enablePolicy = async (params: {
    chatGroupId: string;
    expectedPolicyVersion: number;
    groupPeriodLimitCredits: number;
    periodDurationSeconds: number;
  }) => {
    assertPositiveCredits(params.groupPeriodLimitCredits);
    assertPeriodDuration(params.periodDurationSeconds);
    assertExpectedVersion(params.expectedPolicyVersion, true);

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(params.chatGroupId, database, true);
      await this.assertPrincipalsAvailable(
        { ownerUserId: group.ownerUserId, workspaceId: group.workspaceId },
        database,
      );
      const account = await new PlatformCreditModel(database, group.ownerUserId).getAccount();
      const [existing] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId))
        .for('update');

      const now = new Date();
      let policy: ChatGroupSponsoredCreditPolicyItem;
      if (!existing) {
        if (params.expectedPolicyVersion !== 0) {
          throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
        }
        [policy] = await database
          .insert(chatGroupSponsoredCreditPolicies)
          .values({
            chatGroupId: params.chatGroupId,
            enabled: true,
            groupPeriodLimitCredits: params.groupPeriodLimitCredits,
            payerAccountId: account.id,
            payerUserId: group.ownerUserId,
            payerUserIdSnapshot: group.ownerUserId,
            periodDurationSeconds: params.periodDurationSeconds,
            periodEndsAt: new Date(now.getTime() + params.periodDurationSeconds * 1000),
            periodStartedAt: now,
          })
          .returning();
      } else {
        if (existing.policyVersion !== params.expectedPolicyVersion || existing.enabled) {
          throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
        }
        const currentPeriod = existing.periodEndsAt.getTime() > now.getTime();
        if (currentPeriod && existing.periodDurationSeconds !== params.periodDurationSeconds) {
          throw new Error(CHAT_GROUP_SPONSORED_CREDIT_PERIOD_CHANGE_NOT_ALLOWED);
        }
        const periodStartedAt = currentPeriod ? existing.periodStartedAt : now;
        const periodEndsAt = currentPeriod
          ? existing.periodEndsAt
          : new Date(now.getTime() + params.periodDurationSeconds * 1000);
        [policy] = await database
          .update(chatGroupSponsoredCreditPolicies)
          .set({
            disabledAt: null,
            enabled: true,
            groupPeriodLimitCredits: params.groupPeriodLimitCredits,
            payerAccountId: account.id,
            payerUserId: group.ownerUserId,
            payerUserIdSnapshot: group.ownerUserId,
            periodDurationSeconds: currentPeriod
              ? existing.periodDurationSeconds
              : params.periodDurationSeconds,
            periodEndsAt,
            periodStartedAt,
            policyVersion: existing.policyVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId),
              eq(chatGroupSponsoredCreditPolicies.policyVersion, existing.policyVersion),
              eq(chatGroupSponsoredCreditPolicies.enabled, false),
            ),
          )
          .returning();
        if (!policy) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
      }

      await this.insertAudit(database, {
        action: 'policy_enabled',
        chatGroupId: params.chatGroupId,
        enabled: true,
        groupPeriodLimitCredits: policy.groupPeriodLimitCredits,
        payerUserId: group.ownerUserId,
        policyVersion: policy.policyVersion,
      });
      return policy;
    });
  };

  updatePolicyLimit = async (params: {
    chatGroupId: string;
    expectedPolicyVersion: number;
    groupPeriodLimitCredits: number;
  }) => {
    assertPositiveCredits(params.groupPeriodLimitCredits);
    assertExpectedVersion(params.expectedPolicyVersion);

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(params.chatGroupId, database, true);
      await this.assertPrincipalsAvailable(
        { ownerUserId: group.ownerUserId, workspaceId: group.workspaceId },
        database,
      );
      const [current] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId))
        .for('update');
      if (!current || !current.enabled || current.policyVersion !== params.expectedPolicyVersion) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
      }
      if (current.payerUserIdSnapshot !== group.ownerUserId) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      }
      if (
        current.defaultMemberSponsorshipEnabled &&
        current.defaultMemberPeriodLimitCredits !== null &&
        params.groupPeriodLimitCredits < current.defaultMemberPeriodLimitCredits
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
      }
      const [policy] = await database
        .update(chatGroupSponsoredCreditPolicies)
        .set({
          groupPeriodLimitCredits: params.groupPeriodLimitCredits,
          policyVersion: params.expectedPolicyVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId),
            eq(chatGroupSponsoredCreditPolicies.policyVersion, params.expectedPolicyVersion),
            eq(chatGroupSponsoredCreditPolicies.enabled, true),
          ),
        )
        .returning();
      if (!policy) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);

      await this.insertAudit(database, {
        action: 'policy_limit_updated',
        chatGroupId: params.chatGroupId,
        enabled: true,
        groupPeriodLimitCredits: policy.groupPeriodLimitCredits,
        payerUserId: group.ownerUserId,
        policyVersion: policy.policyVersion,
      });
      return policy;
    });
  };

  updateDefaultMemberSponsorshipTemplate = async (
    params: {
      chatGroupId: string;
      expectedPolicyVersion: number;
    } & (
      | {
          enabled: false;
          maxCreditsPerPeriod?: never;
          maxCreditsPerRequest?: never;
        }
      | {
          enabled: true;
          maxCreditsPerPeriod: number;
          maxCreditsPerRequest: number;
        }
    ),
  ) => {
    assertExpectedVersion(params.expectedPolicyVersion);
    if (params.enabled) {
      assertPositiveCredits(params.maxCreditsPerPeriod);
      assertPositiveCredits(params.maxCreditsPerRequest);
      if (params.maxCreditsPerRequest > params.maxCreditsPerPeriod) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
      }
    }

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(params.chatGroupId, database, true);
      await this.assertPrincipalsAvailable(
        { ownerUserId: group.ownerUserId, workspaceId: group.workspaceId },
        database,
      );
      const [current] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId))
        .for('update');
      if (!current || !current.enabled || current.policyVersion !== params.expectedPolicyVersion) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);
      }
      if (current.payerUserIdSnapshot !== group.ownerUserId) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      }
      if (params.enabled && params.maxCreditsPerPeriod > current.groupPeriodLimitCredits) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
      }

      const [policy] = await database
        .update(chatGroupSponsoredCreditPolicies)
        .set({
          defaultMemberPeriodLimitCredits: params.enabled ? params.maxCreditsPerPeriod : null,
          defaultMemberRequestLimitCredits: params.enabled ? params.maxCreditsPerRequest : null,
          defaultMemberSponsorshipEnabled: params.enabled,
          policyVersion: params.expectedPolicyVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId),
            eq(chatGroupSponsoredCreditPolicies.policyVersion, params.expectedPolicyVersion),
            eq(chatGroupSponsoredCreditPolicies.enabled, true),
          ),
        )
        .returning();
      if (!policy) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);

      await this.insertAudit(database, {
        action: 'policy_default_member_template_updated',
        chatGroupId: params.chatGroupId,
        enabled: params.enabled,
        groupPeriodLimitCredits: policy.groupPeriodLimitCredits,
        memberPeriodLimitCredits: policy.defaultMemberPeriodLimitCredits,
        memberRequestLimitCredits: policy.defaultMemberRequestLimitCredits,
        payerUserId: group.ownerUserId,
        policyVersion: policy.policyVersion,
      });
      return policy;
    });
  };

  disablePolicy = async (params: { chatGroupId: string; expectedPolicyVersion: number }) => {
    assertExpectedVersion(params.expectedPolicyVersion);

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      await this.getGroup(params.chatGroupId, database, true);
      const now = new Date();
      const [policy] = await database
        .update(chatGroupSponsoredCreditPolicies)
        .set({
          defaultMemberPeriodLimitCredits: null,
          defaultMemberRequestLimitCredits: null,
          defaultMemberSponsorshipEnabled: false,
          disabledAt: now,
          enabled: false,
          policyVersion: params.expectedPolicyVersion + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId),
            eq(chatGroupSponsoredCreditPolicies.policyVersion, params.expectedPolicyVersion),
            eq(chatGroupSponsoredCreditPolicies.enabled, true),
          ),
        )
        .returning();
      if (!policy) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT);

      await this.insertAudit(database, {
        action: 'policy_disabled',
        chatGroupId: params.chatGroupId,
        enabled: false,
        groupPeriodLimitCredits: policy.groupPeriodLimitCredits,
        payerUserId: policy.payerUserIdSnapshot,
        policyVersion: policy.policyVersion,
      });
      return policy;
    });
  };

  setMemberPaidAiLimits = async (params: {
    chatGroupId: string;
    expectedMembershipVersion: number;
    maxCreditsPerPeriod: number;
    maxCreditsPerRequest: number;
    memberUserId: string;
  }) => {
    assertExpectedVersion(params.expectedMembershipVersion);
    assertPositiveCredits(params.maxCreditsPerPeriod);
    assertPositiveCredits(params.maxCreditsPerRequest);
    if (params.maxCreditsPerRequest > params.maxCreditsPerPeriod) {
      throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
    }

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(params.chatGroupId, database, true);
      await this.assertPrincipalsAvailable(
        {
          memberUserId: params.memberUserId,
          ownerUserId: group.ownerUserId,
          workspaceId: group.workspaceId,
        },
        database,
      );
      const [policy] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(
          and(
            eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId),
            eq(chatGroupSponsoredCreditPolicies.enabled, true),
          ),
        )
        .for('update');
      if (!policy) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      if (policy.payerUserIdSnapshot !== group.ownerUserId) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      }

      const [current] = await database
        .select()
        .from(chatGroupUserMemberships)
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, params.chatGroupId),
            eq(chatGroupUserMemberships.userId, params.memberUserId),
            isNull(chatGroupUserMemberships.removedAt),
          ),
        )
        .for('update');
      if (!current || current.membershipVersion !== params.expectedMembershipVersion) {
        throw new Error(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);
      }

      const [membership] = await database
        .update(chatGroupUserMemberships)
        .set({
          canUsePaidAi: true,
          maxCreditsPerPeriod: params.maxCreditsPerPeriod,
          maxCreditsPerRequest: params.maxCreditsPerRequest,
          membershipVersion: current.membershipVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, params.chatGroupId),
            eq(chatGroupUserMemberships.userId, params.memberUserId),
            eq(chatGroupUserMemberships.membershipVersion, current.membershipVersion),
            isNull(chatGroupUserMemberships.removedAt),
          ),
        )
        .returning();
      if (!membership) throw new Error(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);

      await this.insertAudit(database, {
        action: current.canUsePaidAi ? 'member_limits_updated' : 'member_granted',
        chatGroupId: params.chatGroupId,
        memberPeriodLimitCredits: membership.maxCreditsPerPeriod,
        memberRequestLimitCredits: membership.maxCreditsPerRequest,
        membershipVersion: membership.membershipVersion,
        payerUserId: group.ownerUserId,
        policyVersion: policy.policyVersion,
        targetUserId: params.memberUserId,
      });
      return membership;
    });
  };

  revokeMemberPaidAi = async (params: {
    chatGroupId: string;
    expectedMembershipVersion: number;
    memberUserId: string;
  }) => {
    assertExpectedVersion(params.expectedMembershipVersion);

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(params.chatGroupId, database, true);
      const [policy] = await database
        .select({
          payerUserIdSnapshot: chatGroupSponsoredCreditPolicies.payerUserIdSnapshot,
          policyVersion: chatGroupSponsoredCreditPolicies.policyVersion,
        })
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId))
        .limit(1);
      const [membership] = await database
        .update(chatGroupUserMemberships)
        .set({
          canUsePaidAi: false,
          maxCreditsPerPeriod: null,
          maxCreditsPerRequest: null,
          membershipVersion: params.expectedMembershipVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, params.chatGroupId),
            eq(chatGroupUserMemberships.userId, params.memberUserId),
            eq(chatGroupUserMemberships.membershipVersion, params.expectedMembershipVersion),
            isNull(chatGroupUserMemberships.removedAt),
          ),
        )
        .returning();
      if (!membership) throw new Error(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);

      await this.insertAudit(database, {
        action: 'member_revoked',
        chatGroupId: params.chatGroupId,
        membershipVersion: membership.membershipVersion,
        payerUserId: policy?.payerUserIdSnapshot ?? group.ownerUserId,
        policyVersion: policy?.policyVersion,
        targetUserId: params.memberUserId,
      });
      return membership;
    });
  };

  /**
   * Resolves an immutable authorization snapshot. The later budget-admission batch must recheck
   * policyVersion and membershipVersion in the same transaction that reserves Credits.
   */
  resolveAdmission = async (params: { chatGroupId: string; maxCredits: number }) => {
    assertPositiveCredits(params.maxCredits);

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(params.chatGroupId, database, false);
      const [storedPolicy] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId))
        .for('update');
      if (
        !storedPolicy ||
        !storedPolicy.enabled ||
        storedPolicy.payerUserIdSnapshot !== group.ownerUserId
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      }
      await this.assertPrincipalsAvailable(
        {
          memberUserId: this.actorUserId,
          ownerUserId: group.ownerUserId,
          workspaceId: group.workspaceId,
        },
        database,
      );

      let policy = storedPolicy;
      const now = new Date();
      if (policy.periodEndsAt.getTime() <= now.getTime()) {
        const [rolled] = await database
          .update(chatGroupSponsoredCreditPolicies)
          .set({
            periodEndsAt: new Date(now.getTime() + policy.periodDurationSeconds * 1000),
            periodStartedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(chatGroupSponsoredCreditPolicies.chatGroupId, params.chatGroupId),
              eq(chatGroupSponsoredCreditPolicies.policyVersion, policy.policyVersion),
              eq(chatGroupSponsoredCreditPolicies.enabled, true),
            ),
          )
          .returning();
        if (!rolled) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
        policy = rolled;
      }

      const [membership] = await database
        .select()
        .from(chatGroupUserMemberships)
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, params.chatGroupId),
            eq(chatGroupUserMemberships.userId, this.actorUserId),
            isNull(chatGroupUserMemberships.removedAt),
          ),
        )
        .for('update');
      if (
        !membership?.canUsePaidAi ||
        !membership.maxCreditsPerRequest ||
        !membership.maxCreditsPerPeriod
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED);
      }
      if (
        params.maxCredits > membership.maxCreditsPerRequest ||
        params.maxCredits > membership.maxCreditsPerPeriod ||
        params.maxCredits > policy.groupPeriodLimitCredits
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
      }

      return {
        actorUserId: this.actorUserId,
        chatGroupId: params.chatGroupId,
        groupPeriodLimitCredits: policy.groupPeriodLimitCredits,
        maxCreditsPerPeriod: membership.maxCreditsPerPeriod,
        maxCreditsPerRequest: membership.maxCreditsPerRequest,
        membershipVersion: membership.membershipVersion,
        payerAccountId: policy.payerAccountId,
        payerUserId: policy.payerUserIdSnapshot,
        periodEndsAt: policy.periodEndsAt,
        periodStartedAt: policy.periodStartedAt,
        policyVersion: policy.policyVersion,
        workspaceId: group.workspaceId,
      };
    });
  };

  /**
   * Atomically validates a human member's current sponsored authorization and reserves a request
   * budget on the current group owner's account. No caller-controlled payer or workspace exists.
   */
  reserveSponsoredBudget = async (input: ReserveSponsoredPlatformCreditBudgetInput) => {
    assertPositiveCredits(input.authorizedCredits);
    assertExpectedVersion(input.expectedMembershipVersion);
    assertExpectedVersion(input.expectedPolicyVersion);
    const chatGroupId = normalizeRequiredText(input.chatGroupId, '群组 ID', 255);
    const expiresAt = normalizeExpiry(input.expiresAt);
    const idempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const requestHash = normalizeRequiredText(input.requestHash, '请求哈希');
    const sourceId = normalizeRequiredText(input.sourceId, '来源 ID');
    const sourceType = normalizeRequiredText(input.sourceType, '来源类型');

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const group = await this.getGroup(chatGroupId, database, false);
      if (
        group.clientId !== DEFAULT_TRAVEL_GROUP_CLIENT_ID ||
        group.visibility !== 'private' ||
        group.workspaceId !== null ||
        group.ownerUserId === this.actorUserId
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
      }

      const [storedPolicy] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, chatGroupId))
        .for('update');
      if (
        !storedPolicy ||
        !storedPolicy.enabled ||
        storedPolicy.payerUserIdSnapshot !== group.ownerUserId ||
        storedPolicy.payerUserId !== group.ownerUserId
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      }

      let policy = storedPolicy;
      const now = new Date();
      if (policy.periodEndsAt.getTime() <= now.getTime()) {
        const [rolled] = await database
          .update(chatGroupSponsoredCreditPolicies)
          .set({
            periodEndsAt: new Date(now.getTime() + policy.periodDurationSeconds * 1000),
            periodStartedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(chatGroupSponsoredCreditPolicies.chatGroupId, chatGroupId),
              eq(chatGroupSponsoredCreditPolicies.policyVersion, policy.policyVersion),
              eq(chatGroupSponsoredCreditPolicies.enabled, true),
            ),
          )
          .returning();
        if (!rolled) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
        policy = rolled;
      }

      const [membership] = await database
        .select()
        .from(chatGroupUserMemberships)
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, chatGroupId),
            eq(chatGroupUserMemberships.userId, this.actorUserId),
            isNull(chatGroupUserMemberships.removedAt),
          ),
        )
        .for('update');
      if (
        !membership?.canUsePaidAi ||
        !membership.maxCreditsPerRequest ||
        !membership.maxCreditsPerPeriod
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_MEMBER_NOT_AUTHORIZED);
      }

      const principals = await database
        .select({ banned: users.banned, id: users.id })
        .from(users)
        .where(inArray(users.id, [group.ownerUserId, this.actorUserId]))
        .for('update');
      if (principals.length !== 2 || principals.some(({ banned }) => banned === true)) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_PRINCIPAL_BLOCKED);
      }
      if (group.workspaceId) {
        const [workspace] = await database
          .select({ frozen: workspaces.frozen })
          .from(workspaces)
          .where(eq(workspaces.id, group.workspaceId))
          .for('update');
        if (!workspace || workspace.frozen === true) {
          throw new Error(CHAT_GROUP_SPONSORED_CREDIT_WORKSPACE_FROZEN);
        }
      }

      const [account] = await database
        .select()
        .from(platformCreditAccounts)
        .where(eq(platformCreditAccounts.id, policy.payerAccountId))
        .for('update');
      if (
        !account ||
        account.userId !== group.ownerUserId ||
        account.userIdSnapshot !== group.ownerUserId
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_POLICY_DISABLED);
      }

      const [existing] = await database
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.idempotencyKey, idempotencyKey),
          ),
        )
        .for('update');
      if (existing) {
        if (
          existing.authorizationKind !== 'group_member_sponsored' ||
          existing.userIdSnapshot !== group.ownerUserId ||
          existing.actorUserIdSnapshot !== this.actorUserId ||
          existing.workspaceId !== group.workspaceId ||
          existing.sourceType !== sourceType ||
          existing.sourceId !== sourceId ||
          existing.requestHash !== requestHash ||
          existing.authorizedCredits !== input.authorizedCredits ||
          existing.sponsorChatGroupIdSnapshot !== chatGroupId ||
          existing.sponsorPolicyVersionSnapshot !== input.expectedPolicyVersion ||
          existing.sponsorPolicyVersionSnapshot !== policy.policyVersion ||
          existing.sponsorMembershipVersionSnapshot !== input.expectedMembershipVersion ||
          existing.sponsorMembershipVersionSnapshot !== membership.membershipVersion ||
          existing.sponsorPeriodStartedAtSnapshot?.getTime() !== policy.periodStartedAt.getTime() ||
          existing.sponsorPeriodEndsAtSnapshot?.getTime() !== policy.periodEndsAt.getTime() ||
          existing.sponsorGroupPeriodLimitCreditsSnapshot !== policy.groupPeriodLimitCredits ||
          existing.sponsorMemberPeriodLimitCreditsSnapshot !== membership.maxCreditsPerPeriod ||
          existing.sponsorMemberRequestLimitCreditsSnapshot !== membership.maxCreditsPerRequest
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }

      if (
        policy.policyVersion !== input.expectedPolicyVersion ||
        membership.membershipVersion !== input.expectedMembershipVersion
      ) {
        throw new Error(
          policy.policyVersion !== input.expectedPolicyVersion
            ? CHAT_GROUP_SPONSORED_CREDIT_POLICY_VERSION_CONFLICT
            : CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT,
        );
      }
      if (
        input.authorizedCredits > membership.maxCreditsPerRequest ||
        input.authorizedCredits > membership.maxCreditsPerPeriod ||
        input.authorizedCredits > policy.groupPeriodLimitCredits
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
      }
      if (expiresAt.getTime() <= Date.now()) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }

      const [existingBySource] = await database
        .select({ id: platformCreditBudgets.id })
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.sourceType, sourceType),
            eq(platformCreditBudgets.sourceId, sourceId),
          ),
        )
        .for('update');
      if (existingBySource) throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);

      const [periodUsage] = await database
        .select({
          groupCredits: sql<number>`coalesce(sum(case
            when ${platformCreditBudgets.status} = 'active' then ${platformCreditBudgets.authorizedCredits}
            when ${platformCreditBudgets.status} = 'settled' then ${platformCreditBudgets.consumedCredits}
            else 0 end), 0)`.mapWith(Number),
          memberCredits: sql<number>`coalesce(sum(case
            when ${platformCreditBudgets.actorUserIdSnapshot} = ${this.actorUserId}
              and ${platformCreditBudgets.status} = 'active'
              then ${platformCreditBudgets.authorizedCredits}
            when ${platformCreditBudgets.actorUserIdSnapshot} = ${this.actorUserId}
              and ${platformCreditBudgets.status} = 'settled'
              then ${platformCreditBudgets.consumedCredits}
            else 0 end), 0)`.mapWith(Number),
        })
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.authorizationKind, 'group_member_sponsored'),
            eq(platformCreditBudgets.sponsorChatGroupIdSnapshot, chatGroupId),
            eq(platformCreditBudgets.sponsorPeriodStartedAtSnapshot, policy.periodStartedAt),
            inArray(platformCreditBudgets.status, ['active', 'settled']),
          ),
        );
      const groupCredits = periodUsage?.groupCredits ?? 0;
      const memberCredits = periodUsage?.memberCredits ?? 0;
      if (
        !Number.isSafeInteger(groupCredits) ||
        !Number.isSafeInteger(memberCredits) ||
        groupCredits < 0 ||
        memberCredits < 0 ||
        groupCredits + input.authorizedCredits > policy.groupPeriodLimitCredits ||
        memberCredits + input.authorizedCredits > membership.maxCreditsPerPeriod
      ) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_INVALID_LIMIT);
      }

      const [holds] = await database
        .select({
          heldCredits:
            sql<number>`coalesce(sum(${platformCreditBudgets.authorizedCredits} - ${platformCreditBudgets.consumedCredits}), 0)`.mapWith(
              Number,
            ),
        })
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.accountId, account.id),
            eq(platformCreditBudgets.status, 'active'),
          ),
        );
      const heldCredits = holds?.heldCredits ?? 0;
      if (
        !Number.isSafeInteger(heldCredits) ||
        heldCredits < 0 ||
        !Number.isSafeInteger(account.balanceCredits) ||
        account.balanceCredits < heldCredits + input.authorizedCredits
      ) {
        throw new Error(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
      }

      const [budget] = await database
        .insert(platformCreditBudgets)
        .values({
          accountId: account.id,
          actorUserId: this.actorUserId,
          actorUserIdSnapshot: this.actorUserId,
          authorizationKind: 'group_member_sponsored',
          authorizedCredits: input.authorizedCredits,
          consumedCredits: 0,
          expiresAt,
          idempotencyKey,
          leaseVersion: 1,
          requestHash,
          sourceId,
          sourceType,
          sponsorChatGroupIdSnapshot: chatGroupId,
          sponsorGroupPeriodLimitCreditsSnapshot: policy.groupPeriodLimitCredits,
          sponsorMemberPeriodLimitCreditsSnapshot: membership.maxCreditsPerPeriod,
          sponsorMemberRequestLimitCreditsSnapshot: membership.maxCreditsPerRequest,
          sponsorMembershipVersionSnapshot: membership.membershipVersion,
          sponsorPeriodEndsAtSnapshot: policy.periodEndsAt,
          sponsorPeriodStartedAtSnapshot: policy.periodStartedAt,
          sponsorPolicyVersionSnapshot: policy.policyVersion,
          status: 'active',
          userId: group.ownerUserId,
          userIdSnapshot: group.ownerUserId,
          workspaceId: group.workspaceId,
        })
        .returning();
      return budget;
    });
  };

  reserveSponsoredRemainingCall = async (
    input: ReserveSponsoredRemainingCallInput,
  ): Promise<PlatformCreditReservationItem> => {
    const budgetId = normalizeRequiredText(input.budgetId, '预算 ID');
    const budgetLeaseVersion = normalizeLeaseVersion(input.budgetLeaseVersion);
    const callKind = normalizeCallKind(input.callKind);
    const expiresAt = normalizeExpiry(input.expiresAt);
    const generationId = normalizeRequiredText(input.generationId, '生成记录 ID');
    const generationType = input.generationType
      ? normalizeRequiredText(input.generationType, '生成类型')
      : null;
    const logicalIdempotencyKey = normalizeRequiredText(input.idempotencyKey, '幂等键', 200);
    const requestHash = normalizeRequiredText(input.requestHash, '请求摘要');
    const idempotencyScope = createHash('sha256').update(logicalIdempotencyKey).digest('hex');
    const requestDigest = createHash('sha256').update(requestHash).digest('hex');
    const idempotencyPrefix = `sponsored-remaining-call:v1:${idempotencyScope}:`;
    const idempotencyKey = `${idempotencyPrefix}${requestDigest}`;
    const model = normalizeRequiredText(input.model, '模型');
    const provider = normalizeRequiredText(input.provider, '模型服务商');

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const [budget] = await database
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetId),
            eq(platformCreditBudgets.authorizationKind, 'group_member_sponsored'),
            eq(platformCreditBudgets.actorUserIdSnapshot, this.actorUserId),
          ),
        )
        .for('update');
      if (!budget || budget.workspaceId !== null) {
        throw new Error(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
      }

      const [existing] = await database
        .select()
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.accountId, budget.accountId),
            or(
              like(platformCreditReservations.idempotencyKey, `${idempotencyPrefix}%`),
              and(
                eq(platformCreditReservations.callKind, callKind),
                eq(platformCreditReservations.generationId, generationId),
              ),
            ),
          ),
        )
        .for('update');
      if (existing) {
        if (
          existing.budgetId !== budget.id ||
          existing.callKind !== callKind ||
          existing.generationId !== generationId ||
          existing.generationType !== generationType ||
          existing.idempotencyKey !== idempotencyKey ||
          existing.model !== model ||
          existing.provider !== provider ||
          existing.workspaceId !== null
        ) {
          throw new Error(PLATFORM_CREDIT_IDEMPOTENCY_CONFLICT);
        }
        return existing;
      }
      if (budget.leaseVersion !== budgetLeaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (
        budget.status !== 'active' ||
        budget.expiresAt.getTime() <= Date.now() ||
        expiresAt.getTime() <= Date.now() ||
        expiresAt.getTime() > budget.expiresAt.getTime()
      ) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_INVALID_STATE);
      }

      const [allocation] = await database
        .select({
          allocatedCredits:
            sql<number>`coalesce(sum(${platformCreditReservations.reservedCredits}), 0)`.mapWith(
              Number,
            ),
        })
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.budgetId, budget.id),
            inArray(platformCreditReservations.status, [
              'reserved',
              'provider_started',
              'provider_completed',
            ]),
          ),
        );
      const allocatedCredits = allocation?.allocatedCredits ?? 0;
      const reservedCredits = budget.authorizedCredits - budget.consumedCredits - allocatedCredits;
      if (!Number.isSafeInteger(reservedCredits) || reservedCredits <= 0) {
        throw new Error(PLATFORM_CREDIT_INSUFFICIENT_BALANCE);
      }

      const [reservation] = await database
        .insert(platformCreditReservations)
        .values({
          accountId: budget.accountId,
          budgetId: budget.id,
          callKind,
          expiresAt,
          generationId,
          generationType,
          idempotencyKey,
          model,
          provider,
          reservedCredits,
          settledCredits: 0,
          status: 'reserved',
          workspaceId: null,
        })
        .returning();
      return reservation;
    });
  };

  claimSponsoredReservationForProvider = async (
    input: ClaimSponsoredReservationForProviderInput,
  ): Promise<ClaimSponsoredReservationForProviderResult> => {
    const reservationId = normalizeRequiredText(input.reservationId, '预留 ID');
    const leaseVersion = normalizeLeaseVersion(input.leaseVersion);

    const [locator] = await this.db
      .select({ budgetId: platformCreditReservations.budgetId })
      .from(platformCreditReservations)
      .where(eq(platformCreditReservations.id, reservationId))
      .limit(1);
    if (!locator) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
    const [budgetLocator] = await this.db
      .select()
      .from(platformCreditBudgets)
      .where(
        and(
          eq(platformCreditBudgets.id, locator.budgetId),
          eq(platformCreditBudgets.authorizationKind, 'group_member_sponsored'),
          eq(platformCreditBudgets.actorUserIdSnapshot, this.actorUserId),
        ),
      )
      .limit(1);
    if (!budgetLocator?.sponsorChatGroupIdSnapshot) {
      throw new Error(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
    }
    const sponsorChatGroupId = budgetLocator.sponsorChatGroupIdSnapshot;

    return this.db.transaction(async (tx) => {
      const database = tx as Database;
      const [group] = await database
        .select({
          clientId: chatGroups.clientId,
          ownerUserId: chatGroups.userId,
          visibility: chatGroups.visibility,
          workspaceId: chatGroups.workspaceId,
        })
        .from(chatGroups)
        .where(eq(chatGroups.id, sponsorChatGroupId))
        .for('update');
      const [policy] = await database
        .select()
        .from(chatGroupSponsoredCreditPolicies)
        .where(eq(chatGroupSponsoredCreditPolicies.chatGroupId, sponsorChatGroupId))
        .for('update');
      const [membership] = await database
        .select()
        .from(chatGroupUserMemberships)
        .where(
          and(
            eq(chatGroupUserMemberships.chatGroupId, sponsorChatGroupId),
            eq(chatGroupUserMemberships.userId, this.actorUserId),
          ),
        )
        .for('update');
      const principals = await database
        .select({ banned: users.banned, id: users.id })
        .from(users)
        .where(inArray(users.id, [budgetLocator.userIdSnapshot, this.actorUserId]))
        .for('update');
      const [account] = await database
        .select()
        .from(platformCreditAccounts)
        .where(eq(platformCreditAccounts.id, budgetLocator.accountId))
        .for('update');
      const [budget] = await database
        .select()
        .from(platformCreditBudgets)
        .where(
          and(
            eq(platformCreditBudgets.id, budgetLocator.id),
            eq(platformCreditBudgets.authorizationKind, 'group_member_sponsored'),
            eq(platformCreditBudgets.actorUserIdSnapshot, this.actorUserId),
          ),
        )
        .for('update');
      const [reservation] = await database
        .select()
        .from(platformCreditReservations)
        .where(
          and(
            eq(platformCreditReservations.id, reservationId),
            eq(platformCreditReservations.budgetId, budgetLocator.id),
            eq(platformCreditReservations.accountId, budgetLocator.accountId),
          ),
        )
        .for('update');
      if (!budget || !reservation) throw new Error(CHAT_GROUP_SPONSORED_CREDIT_FORBIDDEN);
      if (reservation.leaseVersion !== leaseVersion) {
        throw new Error(PLATFORM_CREDIT_RESERVATION_STALE_LEASE);
      }
      if (
        reservation.status === 'provider_started' ||
        reservation.status === 'provider_completed' ||
        reservation.status === 'settled'
      ) {
        return { reservation, shouldCallProvider: false };
      }
      if (reservation.status !== 'reserved') {
        return {
          denial: CHAT_GROUP_SPONSORED_CREDIT_CLAIM_DENIED,
          reservation,
          shouldCallProvider: false,
        };
      }

      const now = Date.now();
      const authorizationValid =
        group?.clientId === DEFAULT_TRAVEL_GROUP_CLIENT_ID &&
        group.visibility === 'private' &&
        group.workspaceId === null &&
        group.ownerUserId === budget.userIdSnapshot &&
        budget.userId === budget.userIdSnapshot &&
        budget.actorUserId === this.actorUserId &&
        budget.sponsorChatGroupIdSnapshot === budgetLocator.sponsorChatGroupIdSnapshot &&
        policy?.enabled === true &&
        policy.payerAccountId === budget.accountId &&
        policy.payerUserId === budget.userIdSnapshot &&
        policy.payerUserIdSnapshot === budget.userIdSnapshot &&
        policy.policyVersion === budget.sponsorPolicyVersionSnapshot &&
        policy.periodStartedAt.getTime() === budget.sponsorPeriodStartedAtSnapshot?.getTime() &&
        policy.periodEndsAt.getTime() === budget.sponsorPeriodEndsAtSnapshot?.getTime() &&
        policy.periodStartedAt.getTime() <= now &&
        policy.periodEndsAt.getTime() > now &&
        policy.groupPeriodLimitCredits === budget.sponsorGroupPeriodLimitCreditsSnapshot &&
        membership?.removedAt === null &&
        membership.canUsePaidAi === true &&
        membership.membershipVersion === budget.sponsorMembershipVersionSnapshot &&
        membership.maxCreditsPerPeriod === budget.sponsorMemberPeriodLimitCreditsSnapshot &&
        membership.maxCreditsPerRequest === budget.sponsorMemberRequestLimitCreditsSnapshot &&
        principals.length === 2 &&
        principals.every(({ banned }) => banned !== true) &&
        account?.userId === budget.userIdSnapshot &&
        account.userIdSnapshot === budget.userIdSnapshot &&
        budget.workspaceId === null &&
        budget.status === 'active' &&
        budget.expiresAt.getTime() > now &&
        budget.authorizedCredits <= (budget.sponsorGroupPeriodLimitCreditsSnapshot ?? 0) &&
        budget.authorizedCredits <= (budget.sponsorMemberPeriodLimitCreditsSnapshot ?? 0) &&
        budget.authorizedCredits <= (budget.sponsorMemberRequestLimitCreditsSnapshot ?? 0) &&
        reservation.workspaceId === null &&
        reservation.expiresAt.getTime() > now;

      if (!authorizationValid) {
        const [released] = await database
          .update(platformCreditReservations)
          .set({ status: 'released', updatedAt: new Date() })
          .where(
            and(
              eq(platformCreditReservations.id, reservation.id),
              eq(platformCreditReservations.status, 'reserved'),
            ),
          )
          .returning();
        return {
          denial: CHAT_GROUP_SPONSORED_CREDIT_CLAIM_DENIED,
          reservation: released ?? reservation,
          shouldCallProvider: false,
        };
      }

      const [claimed] = await database
        .update(platformCreditReservations)
        .set({ status: 'provider_started', updatedAt: new Date() })
        .where(
          and(
            eq(platformCreditReservations.id, reservation.id),
            eq(platformCreditReservations.status, 'reserved'),
          ),
        )
        .returning();
      return { reservation: claimed ?? reservation, shouldCallProvider: Boolean(claimed) };
    });
  };
}
