import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  CHAT_GROUP_INVITATION_INVALID,
  CHAT_GROUP_INVITEE_INVALID,
  CHAT_GROUP_MEMBERSHIP_FORBIDDEN,
  CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID,
  CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT,
  ChatGroupSponsoredCreditModel,
  ChatGroupUserMembershipModel,
} from '../../index';
import {
  chatGroups,
  chatGroupUserInvitations,
  chatGroupUserMemberships,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'cg-human-owner';
const memberId = 'cg-human-member';
const otherUserId = 'cg-human-other';
const groupId = 'cg-human-group';

beforeAll(async () => {
  // The production migration is intentionally deferred while the shared migration journal is busy.
  // Create the contract tables only in this isolated PGlite test database.
  const statements = [
    `
    CREATE TABLE IF NOT EXISTS chat_group_user_memberships (
      chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
      role text NOT NULL DEFAULT 'member',
      can_use_paid_ai boolean NOT NULL DEFAULT false,
      max_credits_per_request bigint,
      max_credits_per_period bigint,
      membership_version integer NOT NULL DEFAULT 1,
      joined_at timestamptz NOT NULL DEFAULT now(),
      removed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_group_id, user_id),
      CONSTRAINT chat_group_user_memberships_role_check CHECK (role = 'member'),
      CONSTRAINT chat_group_user_memberships_paid_ai_limits_check CHECK (
        (
          can_use_paid_ai = false
          AND max_credits_per_request IS NULL
          AND max_credits_per_period IS NULL
        ) OR (
          can_use_paid_ai = true
          AND max_credits_per_request IS NOT NULL
          AND max_credits_per_period IS NOT NULL
          AND max_credits_per_request > 0
          AND max_credits_per_period > 0
          AND max_credits_per_request <= max_credits_per_period
          AND max_credits_per_period <= 9007199254740991
        )
      ),
      CONSTRAINT chat_group_user_memberships_version_check CHECK (membership_version > 0)
    )`,
    `CREATE INDEX IF NOT EXISTS chat_group_user_memberships_user_id_idx
      ON chat_group_user_memberships(user_id)`,
    `
    CREATE TABLE IF NOT EXISTS chat_group_user_invitations (
      id text PRIMARY KEY NOT NULL,
      chat_group_id text NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      inviter_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      role text NOT NULL DEFAULT 'member',
      status text NOT NULL DEFAULT 'pending',
      sponsorship_mode_snapshot text NOT NULL DEFAULT 'none',
      sponsor_policy_version_snapshot integer,
      sponsor_request_limit_credits_snapshot bigint,
      sponsor_period_limit_credits_snapshot bigint,
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chat_group_user_invitations_role_check CHECK (role = 'member'),
      CONSTRAINT chat_group_user_invitations_status_check
        CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
      CONSTRAINT chat_group_user_invitations_token_hash_check
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT chat_group_user_invitations_sponsorship_snapshot_check CHECK (
        (
          sponsorship_mode_snapshot = 'none'
          AND sponsor_policy_version_snapshot IS NULL
          AND sponsor_request_limit_credits_snapshot IS NULL
          AND sponsor_period_limit_credits_snapshot IS NULL
        ) OR (
          sponsorship_mode_snapshot = 'group_owner'
          AND sponsor_policy_version_snapshot > 0
          AND sponsor_request_limit_credits_snapshot > 0
          AND sponsor_period_limit_credits_snapshot > 0
          AND sponsor_request_limit_credits_snapshot <= sponsor_period_limit_credits_snapshot
          AND sponsor_period_limit_credits_snapshot <= 9007199254740991
        )
      )
    )`,
    `ALTER TABLE chat_group_user_invitations
      ADD COLUMN IF NOT EXISTS sponsorship_mode_snapshot text NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS sponsor_policy_version_snapshot integer,
      ADD COLUMN IF NOT EXISTS sponsor_request_limit_credits_snapshot bigint,
      ADD COLUMN IF NOT EXISTS sponsor_period_limit_credits_snapshot bigint`,
    `ALTER TABLE chat_group_sponsored_credit_policies
      ADD COLUMN IF NOT EXISTS default_member_sponsorship_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS default_member_request_limit_credits bigint,
      ADD COLUMN IF NOT EXISTS default_member_period_limit_credits bigint`,
    `ALTER TABLE chat_group_sponsored_credit_audits
      DROP CONSTRAINT IF EXISTS chat_group_sponsored_credit_audits_action_check`,
    `ALTER TABLE chat_group_sponsored_credit_audits
      ADD CONSTRAINT chat_group_sponsored_credit_audits_action_check CHECK (
        action IN (
          'member_granted', 'member_limits_updated', 'member_revoked',
          'policy_disabled', 'policy_default_member_template_updated',
          'policy_enabled', 'policy_limit_updated'
        )
      )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS chat_group_user_invitations_pending_unique
      ON chat_group_user_invitations(chat_group_id, invitee_user_id)
      WHERE status = 'pending'`,
  ];
  for (const statement of statements) await serverDB.execute(sql.raw(statement));
});

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'owner@example.com', id: ownerId },
    {
      avatar: 'https://example.com/member.png',
      email: 'member@example.com',
      fullName: 'Member Name',
      id: memberId,
    },
    { email: 'other@example.com', id: otherUserId, username: 'other-user' },
  ]);
  await serverDB
    .insert(chatGroups)
    .values({ id: groupId, title: 'Private travel group', userId: ownerId });
});

afterEach(async () => {
  await serverDB.delete(users);
});

const enableDefaultOwnerSponsorship = async (
  limits = { maxCreditsPerPeriod: 3000, maxCreditsPerRequest: 500 },
) => {
  const model = new ChatGroupSponsoredCreditModel(serverDB, ownerId);
  await model.enablePolicy({
    chatGroupId: groupId,
    expectedPolicyVersion: 0,
    groupPeriodLimitCredits: 10_000,
    periodDurationSeconds: 86_400,
  });
  return model.updateDefaultMemberSponsorshipTemplate({
    chatGroupId: groupId,
    enabled: true,
    expectedPolicyVersion: 1,
    ...limits,
  });
};

describe('ChatGroupUserMembershipModel invitations', () => {
  it('lets only the group owner create a registered-user invitation and stores only its hash', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);

    const created = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const [stored] = await serverDB
      .select()
      .from(chatGroupUserInvitations)
      .where(eq(chatGroupUserInvitations.id, created.id));

    expect(created.token).toMatch(/^[\w-]{43,}$/);
    expect(created).not.toHaveProperty('tokenHash');
    expect(created).not.toHaveProperty('sponsorshipModeSnapshot');
    expect(created).not.toHaveProperty('sponsorPolicyVersionSnapshot');
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(created.token);
    expect(stored.inviterUserId).toBe(ownerId);
    expect(stored.inviteeUserId).toBe(memberId);
    expect(stored.status).toBe('pending');
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).createInvitation({
        chatGroupId: groupId,
        inviteeUserId: memberId,
      }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);

    await expect(
      ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: 'unregistered-user' }),
    ).rejects.toThrow(CHAT_GROUP_INVITEE_INVALID);
  });

  it('accepts a matching invitation once and creates a paid-AI-disabled membership', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);
    const invitation = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });

    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).acceptInvitation(invitation.token),
    ).rejects.toThrow(CHAT_GROUP_INVITATION_INVALID);

    const accepted = await memberModel.acceptInvitation(invitation.token);
    const [stored] = await serverDB
      .select()
      .from(chatGroupUserMemberships)
      .where(eq(chatGroupUserMemberships.userId, memberId));

    expect(accepted.status).toBe('accepted');
    expect(stored).toMatchObject({
      canUsePaidAi: false,
      chatGroupId: groupId,
      membershipVersion: 1,
      role: 'member',
      userId: memberId,
    });
    expect(stored.removedAt).toBeNull();
    expect(await memberModel.getActiveMembership(groupId)).toMatchObject({
      canUsePaidAi: false,
      chatGroupId: groupId,
      userId: memberId,
    });
    await expect(memberModel.acceptInvitation(invitation.token)).rejects.toThrow(
      CHAT_GROUP_INVITATION_INVALID,
    );
  });

  it('snapshots an enabled owner template and grants its exact paid-AI limits on accept', async () => {
    await enableDefaultOwnerSponsorship();
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const invitation = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const [storedInvitation] = await serverDB
      .select()
      .from(chatGroupUserInvitations)
      .where(eq(chatGroupUserInvitations.id, invitation.id));

    expect(storedInvitation).toMatchObject({
      sponsorPeriodLimitCreditsSnapshot: 3000,
      sponsorPolicyVersionSnapshot: 2,
      sponsorRequestLimitCreditsSnapshot: 500,
      sponsorshipModeSnapshot: 'group_owner',
    });

    const accepted = await new ChatGroupUserMembershipModel(serverDB, memberId).acceptInvitation(
      invitation.token,
    );
    expect(accepted).toMatchObject({
      membership: {
        canUsePaidAi: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        membershipVersion: 1,
      },
      status: 'accepted',
    });
  });

  it('fails closed when the owner sponsorship template drifts after invitation creation', async () => {
    await enableDefaultOwnerSponsorship();
    const invitation = await new ChatGroupUserMembershipModel(serverDB, ownerId).createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await new ChatGroupSponsoredCreditModel(
      serverDB,
      ownerId,
    ).updateDefaultMemberSponsorshipTemplate({
      chatGroupId: groupId,
      enabled: true,
      expectedPolicyVersion: 2,
      maxCreditsPerPeriod: 2000,
      maxCreditsPerRequest: 400,
    });

    await expect(
      new ChatGroupUserMembershipModel(serverDB, memberId).acceptInvitation(invitation.token),
    ).rejects.toThrow('CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT');
    await expect(serverDB.select().from(chatGroupUserMemberships)).resolves.toHaveLength(0);
    await expect(
      serverDB
        .select({ status: chatGroupUserInvitations.status })
        .from(chatGroupUserInvitations)
        .where(eq(chatGroupUserInvitations.id, invitation.id)),
    ).resolves.toEqual([{ status: 'pending' }]);
  });

  it('reports a sponsorship conflict when group ownership drifts before accept', async () => {
    await enableDefaultOwnerSponsorship();
    const invitation = await new ChatGroupUserMembershipModel(serverDB, ownerId).createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await serverDB
      .update(chatGroups)
      .set({ userId: otherUserId })
      .where(eq(chatGroups.id, groupId));

    await expect(
      new ChatGroupUserMembershipModel(serverDB, memberId).acceptInvitation(invitation.token),
    ).rejects.toThrow('CHAT_GROUP_INVITATION_SPONSORSHIP_CONFLICT');
    await expect(serverDB.select().from(chatGroupUserMemberships)).resolves.toHaveLength(0);
  });

  it('accepts an invitation id only for its invitee and lets concurrent attempts win once', async () => {
    const invitation = await new ChatGroupUserMembershipModel(serverDB, ownerId).createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);

    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).acceptInvitationById(invitation.id),
    ).rejects.toThrow(CHAT_GROUP_INVITATION_INVALID);

    const results = await Promise.allSettled([
      memberModel.acceptInvitationById(invitation.id),
      memberModel.acceptInvitationById(invitation.id),
    ]);
    const accepted = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof memberModel.acceptInvitationById>>
      > => result.status === 'fulfilled',
    );
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(accepted).toHaveLength(1);
    expect(accepted[0].value).toMatchObject({
      membership: { chatGroupId: groupId, userId: memberId },
      status: 'accepted',
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({ message: CHAT_GROUP_INVITATION_INVALID }),
    });
    expect(await memberModel.getActiveMembership(groupId)).toMatchObject({
      chatGroupId: groupId,
      userId: memberId,
    });
  });

  it('expires an invitation accepted by id without creating membership', async () => {
    const invitation = await new ChatGroupUserMembershipModel(serverDB, ownerId).createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await serverDB
      .update(chatGroupUserInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatGroupUserInvitations.id, invitation.id));

    await expect(
      new ChatGroupUserMembershipModel(serverDB, memberId).acceptInvitationById(invitation.id),
    ).resolves.toEqual({ status: 'expired' });
    await expect(serverDB.select().from(chatGroupUserMemberships)).resolves.toHaveLength(0);
  });

  it('expires a stale invitation without creating membership', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const invitation = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await serverDB
      .update(chatGroupUserInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatGroupUserInvitations.id, invitation.id));

    const result = await new ChatGroupUserMembershipModel(serverDB, memberId).acceptInvitation(
      invitation.token,
    );
    const memberships = await serverDB.select().from(chatGroupUserMemberships);

    expect(result).toEqual({ status: 'expired' });
    expect(memberships).toHaveLength(0);
  });

  it('expires a stale pending invitation before creating its replacement', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const stale = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await serverDB
      .update(chatGroupUserInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(chatGroupUserInvitations.id, stale.id));

    const replacement = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const invitations = await serverDB
      .select()
      .from(chatGroupUserInvitations)
      .where(
        and(
          eq(chatGroupUserInvitations.chatGroupId, groupId),
          eq(chatGroupUserInvitations.inviteeUserId, memberId),
        ),
      );

    expect(replacement.id).not.toBe(stale.id);
    expect(invitations.filter(({ status }) => status === 'expired')).toHaveLength(1);
    expect(invitations.filter(({ status }) => status === 'pending')).toHaveLength(1);
  });

  it('rejects a second live pending invitation with a stable domain error', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    await ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: memberId });

    await expect(
      ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: memberId }),
    ).rejects.toThrow('CHAT_GROUP_INVITATION_ALREADY_PENDING');
  });

  it('keeps at most one pending invitation under concurrent creation', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const results = await Promise.allSettled([
      ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: memberId }),
      ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: memberId }),
    ]);
    const pending = await serverDB
      .select()
      .from(chatGroupUserInvitations)
      .where(
        and(
          eq(chatGroupUserInvitations.chatGroupId, groupId),
          eq(chatGroupUserInvitations.inviteeUserId, memberId),
          eq(chatGroupUserInvitations.status, 'pending'),
        ),
      );

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(pending).toHaveLength(1);
  });
});

describe('ChatGroupUserMembershipModel revocation and departure', () => {
  it('lets only the owner revoke a pending invitation', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const invitation = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });

    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).revokeInvitation({
        chatGroupId: groupId,
        invitationId: invitation.id,
      }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);

    expect(
      await ownerModel.revokeInvitation({
        chatGroupId: groupId,
        invitationId: invitation.id,
      }),
    ).toEqual({ status: 'revoked' });
    await expect(
      new ChatGroupUserMembershipModel(serverDB, memberId).acceptInvitation(invitation.token),
    ).rejects.toThrow(CHAT_GROUP_INVITATION_INVALID);
  });

  it('lets only the owner remove a member and increments membershipVersion on rejoin', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);
    const firstInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await memberModel.acceptInvitation(firstInvite.token);
    await serverDB
      .update(chatGroupUserMemberships)
      .set({
        canUsePaidAi: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      })
      .where(eq(chatGroupUserMemberships.userId, memberId));

    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).removeMember({
        chatGroupId: groupId,
        expectedMembershipVersion: 1,
        memberUserId: memberId,
      }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);

    const removed = await ownerModel.removeMember({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      memberUserId: memberId,
    });
    expect(removed).toMatchObject({
      canUsePaidAi: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
      membershipVersion: 2,
    });
    expect(removed?.removedAt).toBeInstanceOf(Date);

    const secondInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const rejoined = await memberModel.acceptInvitation(secondInvite.token);
    expect(rejoined.status).toBe('accepted');
    if (rejoined.status === 'accepted') {
      expect(rejoined.membership).toMatchObject({
        canUsePaidAi: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
        membershipVersion: 3,
        removedAt: null,
      });
    }
  });

  it('reinvites with the latest owner template and replaces removed limits exactly', async () => {
    await enableDefaultOwnerSponsorship();
    const ownerMembership = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberMembership = new ChatGroupUserMembershipModel(serverDB, memberId);
    const first = await ownerMembership.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await memberMembership.acceptInvitation(first.token);
    await ownerMembership.removeMember({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      memberUserId: memberId,
    });
    await new ChatGroupSponsoredCreditModel(
      serverDB,
      ownerId,
    ).updateDefaultMemberSponsorshipTemplate({
      chatGroupId: groupId,
      enabled: true,
      expectedPolicyVersion: 2,
      maxCreditsPerPeriod: 2000,
      maxCreditsPerRequest: 400,
    });

    const second = await ownerMembership.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await expect(memberMembership.acceptInvitation(second.token)).resolves.toMatchObject({
      membership: {
        canUsePaidAi: true,
        maxCreditsPerPeriod: 2000,
        maxCreditsPerRequest: 400,
        membershipVersion: 3,
        removedAt: null,
      },
      status: 'accepted',
    });
  });

  it('lets a member leave only their own active membership', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);
    const invitation = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await memberModel.acceptInvitation(invitation.token);
    await serverDB
      .update(chatGroupUserMemberships)
      .set({
        canUsePaidAi: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
      })
      .where(eq(chatGroupUserMemberships.userId, memberId));

    expect(
      await new ChatGroupUserMembershipModel(serverDB, otherUserId).leaveGroup({
        chatGroupId: groupId,
        expectedMembershipVersion: 1,
      }),
    ).toBe(undefined);

    const departed = await memberModel.leaveGroup({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
    });
    expect(departed).toMatchObject({
      canUsePaidAi: false,
      maxCreditsPerPeriod: null,
      maxCreditsPerRequest: null,
      membershipVersion: 2,
    });
    expect(departed?.removedAt).toBeInstanceOf(Date);
    expect(await memberModel.getActiveMembership(groupId)).toBeUndefined();
    expect(
      await memberModel.leaveGroup({ chatGroupId: groupId, expectedMembershipVersion: 1 }),
    ).toBeUndefined();
  });

  it('clears a removed membership authorization when the member rejoins', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);
    const firstInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await memberModel.acceptInvitation(firstInvite.token);
    await serverDB
      .update(chatGroupUserMemberships)
      .set({
        canUsePaidAi: true,
        maxCreditsPerPeriod: 3000,
        maxCreditsPerRequest: 500,
        removedAt: new Date(),
      })
      .where(eq(chatGroupUserMemberships.userId, memberId));

    const secondInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const rejoined = await memberModel.acceptInvitation(secondInvite.token);

    expect(rejoined).toMatchObject({
      membership: {
        canUsePaidAi: false,
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
        removedAt: null,
      },
      status: 'accepted',
    });
  });

  it('rejects stale owner and member mutations after the membership is reactivated', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);
    const firstInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await memberModel.acceptInvitation(firstInvite.token);
    await ownerModel.removeMember({
      chatGroupId: groupId,
      expectedMembershipVersion: 1,
      memberUserId: memberId,
    });
    const secondInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    await memberModel.acceptInvitation(secondInvite.token);

    await expect(
      ownerModel.removeMember({
        chatGroupId: groupId,
        expectedMembershipVersion: 1,
        memberUserId: memberId,
      }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);
    await expect(
      memberModel.leaveGroup({ chatGroupId: groupId, expectedMembershipVersion: 1 }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_VERSION_CONFLICT);
    await expect(memberModel.getActiveMembership(groupId)).resolves.toMatchObject({
      membershipVersion: 3,
      removedAt: null,
    });
  });
});

describe('ChatGroupUserMembershipModel safe owner lists', () => {
  it('lists active human members with a bounded safe projection', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    const memberModel = new ChatGroupUserMembershipModel(serverDB, memberId);
    const otherModel = new ChatGroupUserMembershipModel(serverDB, otherUserId);
    const firstInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: memberId,
    });
    const secondInvite = await ownerModel.createInvitation({
      chatGroupId: groupId,
      inviteeUserId: otherUserId,
    });
    await memberModel.acceptInvitation(firstInvite.token);
    await otherModel.acceptInvitation(secondInvite.token);

    const firstPage = await ownerModel.listHumanMembers({ chatGroupId: groupId, limit: 1 });
    const secondPage = await ownerModel.listHumanMembers({
      chatGroupId: groupId,
      limit: 1,
      offset: firstPage.nextOffset!,
    });

    expect(firstPage.nextOffset).toBe(1);
    expect(secondPage.nextOffset).toBeNull();
    expect([...firstPage.items, ...secondPage.items]).toEqual([
      {
        avatar: 'https://example.com/member.png',
        canUsePaidAi: false,
        displayName: 'Member Name',
        joinedAt: expect.any(Date),
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
        membershipVersion: 1,
        userId: memberId,
      },
      {
        avatar: null,
        canUsePaidAi: false,
        displayName: 'other-user',
        joinedAt: expect.any(Date),
        maxCreditsPerPeriod: null,
        maxCreditsPerRequest: null,
        membershipVersion: 1,
        userId: otherUserId,
      },
    ]);
    expect(Object.keys(firstPage.items[0]).sort()).toEqual([
      'avatar',
      'canUsePaidAi',
      'displayName',
      'joinedAt',
      'maxCreditsPerPeriod',
      'maxCreditsPerRequest',
      'membershipVersion',
      'userId',
    ]);
    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).listHumanMembers({
        chatGroupId: groupId,
      }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);
    await expect(ownerModel.listHumanMembers({ chatGroupId: groupId, limit: 51 })).rejects.toThrow(
      CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID,
    );
  });

  it('lists live pending invitations with masked email and no token material', async () => {
    const ownerModel = new ChatGroupUserMembershipModel(serverDB, ownerId);
    await ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: memberId });
    await ownerModel.createInvitation({ chatGroupId: groupId, inviteeUserId: otherUserId });

    const result = await ownerModel.listPendingInvitations({ chatGroupId: groupId, limit: 2 });

    expect(result.nextOffset).toBeNull();
    expect(result.items).toHaveLength(2);
    expect(result.items.map(({ maskedEmail }) => maskedEmail).sort()).toEqual([
      'm***@example.com',
      'o***@example.com',
    ]);
    expect(result.items.every(({ status }) => status === 'pending')).toBe(true);
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'expiresAt',
      'id',
      'maskedEmail',
      'status',
    ]);
    await expect(
      new ChatGroupUserMembershipModel(serverDB, otherUserId).listPendingInvitations({
        chatGroupId: groupId,
      }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_FORBIDDEN);
    await expect(
      ownerModel.listPendingInvitations({ chatGroupId: groupId, limit: 51 }),
    ).rejects.toThrow(CHAT_GROUP_MEMBERSHIP_PAGINATION_INVALID);
  });
});
