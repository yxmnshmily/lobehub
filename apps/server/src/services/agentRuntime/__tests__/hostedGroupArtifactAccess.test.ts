// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createHostedGroupArtifactHandle,
  HOSTED_GROUP_ARTIFACT_NOT_FOUND,
  resolveHostedGroupArtifact,
} from '../hostedGroupArtifactAccess';

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  record: vi.fn(),
}));

vi.mock('@/database/models/hostedGroupArtifactAccess', () => ({
  HostedGroupArtifactAccessModel: class {
    findAuthorizedCandidate = mocks.find;
    record = mocks.record;
  },
}));

const now = new Date('2026-09-04T00:20:00.000Z');
const publishedAt = '2026-09-04T00:10:00.000Z';
const baseInput = {
  actorUserId: 'member-actor',
  artifactInternalId: 'server-internal-document-id',
  artifactKind: 'document' as const,
  groupId: 'hosted-group',
  membershipVersion: 4,
  operationId: 'hosted-operation',
  ownerUserId: 'group-owner',
  publishedAt,
};

describe('hosted group artifact access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.record.mockResolvedValue(true);
  });

  it.each(['text', 'document'] as const)(
    'creates a random %s handle while persisting only its SHA-256 binding',
    async (artifactKind) => {
      const result = await createHostedGroupArtifactHandle(
        {} as any,
        { ...baseInput, artifactKind },
        now,
      );

      expect(result.handle).toMatch(/^[\w-]{43}$/);
      expect(result.artifact).toEqual({ artifactKind, publishedAt });
      expect(Object.keys(result.artifact).sort()).toEqual(['artifactKind', 'publishedAt']);
      const persisted = mocks.record.mock.calls[0]?.[0];
      expect(persisted).toMatchObject({
        actorUserIdSnapshot: baseInput.actorUserId,
        artifactInternalId: baseInput.artifactInternalId,
        artifactKind,
        groupId: baseInput.groupId,
        membershipVersion: baseInput.membershipVersion,
        operationId: baseInput.operationId,
        ownerUserIdSnapshot: baseInput.ownerUserId,
        publishedAt,
        version: 1,
      });
      expect(persisted.handleHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(persisted)).not.toContain(result.handle);
    },
  );

  it('resolves the opaque handle to a strict metadata-only projection', async () => {
    const created = await createHostedGroupArtifactHandle({} as any, baseInput, now);
    const persisted = mocks.record.mock.calls[0]?.[0];
    mocks.find.mockResolvedValue({
      marker: persisted,
      operationGroupId: baseInput.groupId,
      operationId: baseInput.operationId,
      operationOwnerUserId: baseInput.ownerUserId,
      readerJoinedAt: new Date('2026-09-04T00:05:00.000Z'),
      readerMembershipVersion: 9,
    });

    const result = await resolveHostedGroupArtifact(
      {} as any,
      { groupId: baseInput.groupId, handle: created.handle, readerUserId: 'same-group-reader' },
      now,
    );

    expect(result).toEqual({ artifactKind: 'document', publishedAt });
    expect(JSON.stringify(result)).not.toMatch(
      /owner|task|operation|provider|model|usage|page|work|internal/i,
    );
  });

  it.each([
    ['expired', { expiresAt: '2026-09-04T00:19:59.999Z' }],
    ['wrong group', { groupId: 'another-group' }],
    ['wrong owner', { ownerUserIdSnapshot: 'another-owner' }],
    ['wrong operation', { operationId: 'another-operation' }],
    ['joined after publication', {}, new Date('2026-09-04T00:10:00.001Z')],
    ['extra private field', { provider: 'private-provider' }],
  ])(
    'fails closed for %s',
    async (_case, markerChange, joinedAt = new Date('2026-09-04T00:05:00.000Z')) => {
      const created = await createHostedGroupArtifactHandle({} as any, baseInput, now);
      const persisted = mocks.record.mock.calls[0]?.[0];
      mocks.find.mockResolvedValue({
        marker: { ...persisted, ...markerChange },
        operationGroupId: baseInput.groupId,
        operationId: baseInput.operationId,
        operationOwnerUserId: baseInput.ownerUserId,
        readerJoinedAt: joinedAt,
        readerMembershipVersion: 9,
      });

      await expect(
        resolveHostedGroupArtifact(
          {} as any,
          { groupId: baseInput.groupId, handle: created.handle, readerUserId: 'same-group-reader' },
          now,
        ),
      ).rejects.toMatchObject({ code: HOSTED_GROUP_ARTIFACT_NOT_FOUND });
    },
  );

  it('rejects malformed creation input and a refused durable write', async () => {
    await expect(
      createHostedGroupArtifactHandle(
        {} as any,
        { ...baseInput, actorUserId: baseInput.ownerUserId },
        now,
      ),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_ARTIFACT_NOT_FOUND });
    expect(mocks.record).not.toHaveBeenCalled();

    await expect(
      createHostedGroupArtifactHandle(
        {} as any,
        { ...baseInput, provider: 'must-not-enter-marker' },
        now,
      ),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_ARTIFACT_NOT_FOUND });
    expect(mocks.record).not.toHaveBeenCalled();

    mocks.record.mockResolvedValue(false);
    await expect(createHostedGroupArtifactHandle({} as any, baseInput, now)).rejects.toMatchObject({
      code: HOSTED_GROUP_ARTIFACT_NOT_FOUND,
    });
  });

  it('rejects an invalid handle or a removed/reinvited member before any projection', async () => {
    await expect(
      resolveHostedGroupArtifact(
        {} as any,
        { groupId: baseInput.groupId, handle: 'not-a-handle', readerUserId: 'reader' },
        now,
      ),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_ARTIFACT_NOT_FOUND });
    expect(mocks.find).not.toHaveBeenCalled();

    mocks.find.mockResolvedValue(null);
    await expect(
      resolveHostedGroupArtifact(
        {} as any,
        { groupId: baseInput.groupId, handle: 'A'.repeat(43), readerUserId: 'reader' },
        now,
      ),
    ).rejects.toMatchObject({ code: HOSTED_GROUP_ARTIFACT_NOT_FOUND });
  });
});
