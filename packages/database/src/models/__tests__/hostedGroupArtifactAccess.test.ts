import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  chatGroups,
  chatGroupUserMemberships,
  users,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { HostedGroupArtifactAccessModel } from '../hostedGroupArtifactAccess';

const db: LobeChatDatabase = await getTestDB();
const ownerUserId = 'hosted-artifact-owner';
const actorUserId = 'hosted-artifact-actor';
const readerUserId = 'hosted-artifact-reader';
const lateReaderUserId = 'hosted-artifact-late-reader';
const groupId = 'hosted-artifact-group';
const operationId = 'hosted-artifact-operation';
const publishedAt = '2026-09-03T20:10:00.000Z';
const expiresAt = '2099-09-05T00:10:00.000Z';
const handleHash = 'a'.repeat(64);
const userIds = [ownerUserId, actorUserId, readerUserId, lateReaderUserId];

const marker = {
  actorUserIdSnapshot: actorUserId,
  artifactInternalId: 'internal-document-id',
  artifactKind: 'document' as const,
  expiresAt,
  groupId,
  handleHash,
  membershipVersion: 4,
  operationId,
  ownerUserIdSnapshot: ownerUserId,
  publishedAt,
  version: 1 as const,
};

const cleanup = async () => {
  await db.delete(agentOperations).where(eq(agentOperations.id, operationId));
  await db.delete(chatGroups).where(eq(chatGroups.id, groupId));
  await db.delete(users).where(inArray(users.id, userIds));
};

beforeEach(async () => {
  await cleanup();
  await db.insert(users).values(userIds.map((id) => ({ id })));
  await db.insert(chatGroups).values({ id: groupId, title: 'Hosted artifact group', userId: ownerUserId });
  await db.insert(chatGroupUserMemberships).values([
    {
      chatGroupId: groupId,
      joinedAt: new Date('2026-09-03T20:00:00.000Z'),
      membershipVersion: marker.membershipVersion,
      userId: actorUserId,
    },
    {
      chatGroupId: groupId,
      joinedAt: new Date('2026-09-03T20:05:00.000Z'),
      membershipVersion: 1,
      userId: readerUserId,
    },
    {
      chatGroupId: groupId,
      joinedAt: new Date('2026-09-03T20:11:00.000Z'),
      membershipVersion: 3,
      userId: lateReaderUserId,
    },
  ]);
  await db.insert(agentOperations).values({
    chatGroupId: groupId,
    id: operationId,
    metadata: {
      hostedGroupMemberFinal: {
        actorUserIdSnapshot: actorUserId,
        assistantMessageId: 'assistant-message',
        contentHash: 'b'.repeat(64),
        groupId,
        membershipVersion: marker.membershipVersion,
        operationId,
        ownerUserIdSnapshot: ownerUserId,
        publishedAt,
        version: 1,
      },
      hostedGroupRun: {
        actorUserIdSnapshot: actorUserId,
        expiresAt,
        groupId,
        handleHash: 'c'.repeat(64),
        membershipVersion: marker.membershipVersion,
        ownerUserIdSnapshot: ownerUserId,
        version: 1,
      },
      preserved: true,
    },
    status: 'done',
    userId: ownerUserId,
  });
});

afterEach(cleanup);

describe('HostedGroupArtifactAccessModel', () => {
  it('records an exact server-only hash once and preserves existing operation metadata', async () => {
    const model = new HostedGroupArtifactAccessModel(db);

    await expect(model.record(marker)).resolves.toBe(true);
    await expect(model.record(marker)).resolves.toBe(true);

    const [operation] = await db
      .select({ metadata: agentOperations.metadata })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId));
    expect(operation.metadata).toMatchObject({
      hostedGroupArtifactAccess: [marker],
      preserved: true,
    });
    expect(JSON.stringify(operation.metadata)).not.toContain('artifactHandle');
  });

  it('rejects a conflicting hash and any operation/final binding mismatch', async () => {
    const model = new HostedGroupArtifactAccessModel(db);
    await expect(model.record(marker)).resolves.toBe(true);

    await expect(
      model.record({ ...marker, artifactInternalId: 'other-internal-id' }),
    ).resolves.toBe(false);
    await expect(model.record({ ...marker, ownerUserIdSnapshot: readerUserId })).resolves.toBe(false);
    await expect(model.record({ ...marker, membershipVersion: 5 })).resolves.toBe(false);

    const [operation] = await db
      .select({ metadata: agentOperations.metadata })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId));
    expect((operation.metadata as any).hostedGroupArtifactAccess).toEqual([marker]);
  });

  it('returns one candidate only to a current same-group member who joined before publication', async () => {
    const model = new HostedGroupArtifactAccessModel(db);
    await model.record(marker);

    await expect(
      model.findAuthorizedCandidate({ groupId, handleHash, readerUserId }),
    ).resolves.toMatchObject({
      marker,
      operationGroupId: groupId,
      operationId,
      operationOwnerUserId: ownerUserId,
      readerJoinedAt: new Date('2026-09-03T20:05:00.000Z'),
    });
    await expect(
      model.findAuthorizedCandidate({ groupId, handleHash, readerUserId: lateReaderUserId }),
    ).resolves.toBeNull();
    await expect(
      model.findAuthorizedCandidate({ groupId: 'another-group', handleHash, readerUserId }),
    ).resolves.toBeNull();
  });

  it('fails closed after removal and after a later rejoin', async () => {
    const model = new HostedGroupArtifactAccessModel(db);
    await model.record(marker);
    await db
      .update(chatGroupUserMemberships)
      .set({ removedAt: new Date('2026-09-03T20:12:00.000Z') })
      .where(
        inArray(chatGroupUserMemberships.userId, [actorUserId, readerUserId]),
      );

    await expect(
      model.findAuthorizedCandidate({ groupId, handleHash, readerUserId }),
    ).resolves.toBeNull();

    await db
      .update(chatGroupUserMemberships)
      .set({
        joinedAt: new Date('2026-09-03T20:13:00.000Z'),
        membershipVersion: 2,
        removedAt: null,
      })
      .where(eq(chatGroupUserMemberships.userId, readerUserId));
    await expect(
      model.findAuthorizedCandidate({ groupId, handleHash, readerUserId }),
    ).resolves.toBeNull();
  });
});
