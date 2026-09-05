// @vitest-environment node
import type { LobeChatDatabase } from '@lobechat/database';
import { agents, chatGroups, chatGroupsAgents, users } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID } from './travelServiceGroup';
import {
  assertDefaultTravelServiceMutationAllowed,
  assertNoReservedTravelServiceIdentity,
} from './travelServiceGroupMutationGuard';

const ownerId = 'travel-mutation-guard-owner';
const attackerId = 'travel-mutation-guard-attacker';
const db: LobeChatDatabase = await getTestDB();

beforeAll(async () => {
  await db.insert(users).values([
    { email: 'travel-guard-owner@example.test', id: ownerId },
    { email: 'travel-guard-attacker@example.test', id: attackerId },
  ]);
  await db.insert(chatGroups).values([
    {
      clientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      id: 'travel-guard-default-group',
      title: '旅游制作群',
      userId: ownerId,
      visibility: 'private',
    },
    {
      id: 'travel-guard-custom-group',
      title: '旅游制作群',
      userId: ownerId,
      visibility: 'private',
    },
  ]);
  await db.insert(agents).values([
    {
      agencyConfig: { modelRuntimeMode: 'platform-managed', modelSelectionPolicy: 'fixed' },
      id: 'travel-guard-supervisor',
      slug: 'group-supervisor',
      title: '旅游群主AI',
      userId: ownerId,
      virtual: true,
    },
    {
      id: 'travel-guard-same-title-custom-agent',
      slug: 'my-own-tourism-helper',
      title: '旅游群主AI',
      userId: ownerId,
    },
    {
      id: 'travel-guard-ordinary-member',
      slug: 'ordinary-member',
      title: '普通助手',
      userId: ownerId,
    },
  ]);
  await db.insert(chatGroupsAgents).values({
    agentId: 'travel-guard-supervisor',
    chatGroupId: 'travel-guard-default-group',
    role: 'supervisor',
    userId: ownerId,
  });
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, ownerId));
  await db.delete(users).where(eq(users.id, attackerId));
});

describe('default travel service object mutation guard', () => {
  it('blocks a managed supervisor even after its mutable identity markers are damaged', async () => {
    await db
      .update(agents)
      .set({
        agencyConfig: { modelRuntimeMode: 'actor', modelSelectionPolicy: 'member' },
        slug: 'damaged-supervisor-slug',
      })
      .where(eq(agents.id, 'travel-guard-supervisor'));

    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        agentIds: ['travel-guard-supervisor'],
        kind: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks a forged cross-user protected id without leaking ownership details', async () => {
    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: attackerId,
        agentIds: ['travel-guard-supervisor'],
        kind: 'agent',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'This platform-managed travel resource cannot be changed',
    });
  });

  it('allows a user-created agent with the same display title', async () => {
    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        agentIds: ['travel-guard-same-title-custom-agent'],
        kind: 'agent',
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks the default group but allows a custom group with the same title', async () => {
    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        groupId: 'travel-guard-default-group',
        kind: 'group',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        groupId: 'travel-guard-custom-group',
        kind: 'group',
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks every membership change in the default group', async () => {
    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        agentIds: ['travel-guard-ordinary-member'],
        groupId: 'travel-guard-default-group',
        kind: 'membership',
        operation: 'add',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        agentIds: ['travel-guard-supervisor'],
        groupId: 'travel-guard-default-group',
        kind: 'membership',
        operation: 'remove',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      assertDefaultTravelServiceMutationAllowed(db, {
        actorUserId: ownerId,
        agentIds: ['travel-guard-ordinary-member'],
        groupId: 'travel-guard-default-group',
        kind: 'membership',
        operation: 'update',
        role: 'supervisor',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects reserved group and agent identities before creation or import', () => {
    expect(() =>
      assertNoReservedTravelServiceIdentity({
        groupClientId: DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
      }),
    ).toThrow('This platform-managed travel resource cannot be changed');
    expect(() => assertNoReservedTravelServiceIdentity({ agentSlug: 'group-supervisor' })).toThrow(
      'This platform-managed travel resource cannot be changed',
    );
    expect(() =>
      assertNoReservedTravelServiceIdentity({ agentClientId: 'default-travel-copywriter' }),
    ).toThrow('This platform-managed travel resource cannot be changed');
    expect(() => assertNoReservedTravelServiceIdentity({ agentTitle: '旅游群主AI' })).not.toThrow();
  });
});
