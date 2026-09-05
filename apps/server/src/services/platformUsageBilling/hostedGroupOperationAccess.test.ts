// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authorizeHostedGroupRun,
  createHostedGroupRunBinding,
  projectHostedGroupRunStatus,
} from './hostedGroupOperationAccess';

const mocks = vi.hoisted(() => ({ resolveTarget: vi.fn() }));

vi.mock('./groupChat', () => ({ resolveHostedTravelGroupTarget: mocks.resolveTarget }));

const collectSqlPrimitiveValues = (value: unknown, seen = new WeakSet<object>()): string[] => {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, nested]) =>
    key === 'table' ? [] : collectSqlPrimitiveValues(nested, seen),
  );
};

describe('hosted group opaque operation access', () => {
  const actorUserId = 'invited-member';
  const groupId = 'default-private-travel-group';
  const ownerUserId = 'group-owner';
  let binding: ReturnType<typeof createHostedGroupRunBinding>;
  let row: any;
  let db: any;
  let where: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    binding = createHostedGroupRunBinding({
      actorUserId,
      groupId,
      membershipVersion: 7,
      ownerUserId,
    });
    row = {
      chatGroupId: groupId,
      completedAt: null,
      error: null,
      id: 'internal-operation-id',
      metadata: { hostedGroupRun: binding.snapshot },
      startedAt: new Date('2026-09-04T00:00:00.000Z'),
      status: 'running',
      updatedAt: new Date('2026-09-04T00:01:00.000Z'),
      userId: ownerUserId,
      workspaceId: null,
    };
    where = vi.fn(() => ({ limit: vi.fn(async () => [row]) }));
    db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where,
        })),
      })),
    };
    mocks.resolveTarget.mockResolvedValue({
      groupId,
      principal: {
        actorUserId,
        kind: 'owner-sponsored-member',
        membershipVersion: 7,
        resourceOwnerUserId: ownerUserId,
      },
    });
  });

  it('returns a high-entropy opaque handle while persisting only its hash', () => {
    expect(binding.runHandle).toMatch(/^[\w-]{43}$/);
    expect(binding.snapshot.handleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(binding.snapshot)).not.toContain(binding.runHandle);
  });

  it('authorizes only the persisted actor who is still the same active member', async () => {
    const access = await authorizeHostedGroupRun({
      db,
      groupId,
      runHandle: binding.runHandle,
      userId: actorUserId,
    });

    expect(access.operationId).toBe('internal-operation-id');
    expect(projectHostedGroupRunStatus(access)).toEqual({
      completedAt: null,
      errorSummary: null,
      startedAt: '2026-09-04T00:00:00.000Z',
      status: 'running',
      updatedAt: '2026-09-04T00:01:00.000Z',
    });
    expect(projectHostedGroupRunStatus(access)).not.toHaveProperty('operationId');
    const serializedFilter = collectSqlPrimitiveValues(where.mock.calls[0]?.[0]).join(' ');
    expect(serializedFilter).toContain(binding.snapshot.handleHash);
    expect(serializedFilter).toContain(actorUserId);
    expect(serializedFilter).toContain(ownerUserId);
    expect(serializedFilter).toContain(groupId);
    expect(serializedFilter).toContain(String(binding.snapshot.membershipVersion));
  });

  it('rejects a non-member before querying operation handles', async () => {
    mocks.resolveTarget.mockRejectedValue(new Error('not a current member'));

    await expect(
      authorizeHostedGroupRun({ db, groupId, runHandle: binding.runHandle, userId: actorUserId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(db.select).not.toHaveBeenCalled();
  });

  it.each([
    ['another member', () => ({ userId: 'other-member' })],
    [
      'expired handle',
      () => {
        row.metadata.hostedGroupRun.expiresAt = '2020-01-01T00:00:00.000Z';
        return {};
      },
    ],
    [
      'removed member',
      () => {
        mocks.resolveTarget.mockRejectedValue(new Error('removed'));
        return {};
      },
    ],
    [
      'membership version drift',
      () => {
        mocks.resolveTarget.mockResolvedValue({
          groupId,
          principal: {
            actorUserId,
            kind: 'owner-sponsored-member',
            membershipVersion: 8,
            resourceOwnerUserId: ownerUserId,
          },
        });
        return {};
      },
    ],
  ])('returns NOT_FOUND for %s', async (_name, arrange) => {
    const overrides = arrange();
    await expect(
      authorizeHostedGroupRun({
        db,
        groupId,
        runHandle: binding.runHandle,
        userId: actorUserId,
        ...overrides,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns only a fixed error summary', async () => {
    row.error = { message: 'provider=openai model=secret stack=/internal/path' };
    row.status = 'error';
    const access = await authorizeHostedGroupRun({
      db,
      groupId,
      runHandle: binding.runHandle,
      userId: actorUserId,
    });

    expect(projectHostedGroupRunStatus(access).errorSummary).toBe('任务执行失败，请稍后重试。');
    expect(JSON.stringify(projectHostedGroupRunStatus(access))).not.toContain('openai');
  });
});
