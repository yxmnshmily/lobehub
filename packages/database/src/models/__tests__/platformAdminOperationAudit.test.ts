// @vitest-environment node
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { platformAdminOperationAudits } from '../../schemas';
import {
  PLATFORM_ADMIN_OPERATION_AUDIT_CONFLICT,
  PlatformAdminOperationAuditModel,
} from '../platformAdminOperationAudit';

const db = await getTestDB();

describe('PlatformAdminOperationAuditModel', () => {
  it('appends a fixed, data-minimised request/result event chain', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const envelope = {
      action: 'user.password_reset_requested' as const,
      operationId: 'platform-audit-model-reset-1',
      operatorUserId: 'platform-audit-model-admin',
      targetUserId: 'platform-audit-model-target',
    };

    const requested = await model.recordEvent({ ...envelope, phase: 'requested' });
    const succeeded = await model.recordEvent({ ...envelope, phase: 'succeeded' });

    expect(requested).toMatchObject({ ...envelope, phase: 'requested' });
    expect(succeeded).toMatchObject({ ...envelope, phase: 'succeeded' });
    expect(requested.occurredAt).toBeInstanceOf(Date);
    expect(succeeded.occurredAt).toBeInstanceOf(Date);
    expect(Object.keys(requested).sort()).toEqual([
      'action',
      'id',
      'occurredAt',
      'operationId',
      'operatorUserId',
      'phase',
      'targetUserId',
    ]);
  });

  it('records the dedicated travel-group repair action without accepting repair details', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const secret = 'GROUP_PROMPT_MODEL_KEY_MEMBER_IDS_MUST_NOT_BE_STORED';
    const operationId = 'platform-audit-model-travel-group-repair-1';

    const result = await model.runOperation(
      {
        action: 'user.travel_group_repaired',
        actionCounts: [{ code: 'SET_PRIVATE', count: 1 }],
        memberIds: [secret],
        operationId,
        operatorUserId: 'platform-audit-model-admin',
        planFingerprint: secret,
        prompt: secret,
        targetUserId: 'platform-audit-model-target',
      } as never,
      async () => ({ repaired: true }),
    );

    expect(result).toEqual({ repaired: true });
    const events = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(events.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.travel_group_repaired', phase: 'requested' },
      { action: 'user.travel_group_repaired', phase: 'succeeded' },
    ]);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('returns the original event for an identical operation phase retry', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const input = {
      action: 'user.sessions_revoked' as const,
      operationId: 'platform-audit-model-revoke-1',
      operatorUserId: 'platform-audit-model-admin',
      phase: 'requested' as const,
      targetUserId: 'platform-audit-model-target',
    };

    const first = await model.recordEvent(input);
    const retry = await model.recordEvent(input);

    expect(retry).toEqual(first);
    await expect(
      db
        .select()
        .from(platformAdminOperationAudits)
        .where(eq(platformAdminOperationAudits.operationId, input.operationId)),
    ).resolves.toHaveLength(1);
  });

  it('rejects reuse of an operation phase for a different audit envelope', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const input = {
      action: 'user.banned' as const,
      operationId: 'platform-audit-model-conflict-1',
      operatorUserId: 'platform-audit-model-admin',
      phase: 'requested' as const,
      targetUserId: 'platform-audit-model-target',
    };

    await model.recordEvent(input);

    await expect(
      model.recordEvent({ ...input, action: 'user.sessions_revoked' }),
    ).resolves.toMatchObject({ action: 'user.sessions_revoked', operationId: input.operationId });
    await expect(model.recordEvent({ ...input, targetUserId: 'different-target' })).rejects.toThrow(
      PLATFORM_ADMIN_OPERATION_AUDIT_CONFLICT,
    );
  });

  it('ignores forbidden caller fields and rejects unsupported actions or phases', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const secret = 'PASSWORD_TOKEN_EMAIL_BODY_IP_MUST_NOT_BE_STORED';
    const record = await model.recordEvent({
      action: 'user.profile_updated',
      emailBody: secret,
      ipAddress: secret,
      metadata: { secret },
      operationId: 'platform-audit-model-minimal-1',
      operatorUserId: 'platform-audit-model-admin',
      password: secret,
      phase: 'succeeded',
      targetUserId: 'platform-audit-model-target',
      token: secret,
    } as never);

    expect(JSON.stringify(record)).not.toContain(secret);
    const [stored] = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.id, record.id));
    expect(JSON.stringify(stored)).not.toContain(secret);
    await expect(
      model.recordEvent({
        action: 'user.email_body_captured',
        operationId: 'platform-audit-model-invalid-action',
        operatorUserId: 'platform-audit-model-admin',
        phase: 'requested',
        targetUserId: 'platform-audit-model-target',
      } as never),
    ).rejects.toThrow(/action/i);
    await expect(
      model.recordEvent({
        action: 'user.profile_updated',
        operationId: 'platform-audit-model-invalid-phase',
        operatorUserId: 'platform-audit-model-admin',
        phase: 'unknown',
        targetUserId: 'platform-audit-model-target',
      } as never),
    ).rejects.toThrow(/phase/i);
  });

  it('records requested then succeeded without accepting the operation result as metadata', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const operationId = 'platform-audit-model-run-success-1';

    const result = await model.runOperation(
      {
        action: 'user.profile_updated',
        operationId,
        operatorUserId: 'platform-audit-model-admin',
        targetUserId: 'platform-audit-model-target',
      },
      async () => ({ privateValue: 'PROFILE_VALUE_MUST_NOT_BE_STORED' }),
    );

    expect(result).toEqual({ privateValue: 'PROFILE_VALUE_MUST_NOT_BE_STORED' });
    const events = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(events.map(({ phase }) => phase).sort()).toEqual(['requested', 'succeeded']);
    expect(JSON.stringify(events)).not.toContain('PROFILE_VALUE_MUST_NOT_BE_STORED');
  });

  it('records requested then failed without persisting the thrown error', async () => {
    const model = new PlatformAdminOperationAuditModel(db);
    const operationId = 'platform-audit-model-run-failed-1';
    const secret = 'SMTP_TOKEN_MUST_NOT_BE_STORED';

    await expect(
      model.runOperation(
        {
          action: 'user.password_reset_requested',
          operationId,
          operatorUserId: 'platform-audit-model-admin',
          targetUserId: 'platform-audit-model-target',
        },
        async () => {
          throw new Error(secret);
        },
      ),
    ).rejects.toThrow(secret);

    const events = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(events.map(({ phase }) => phase).sort()).toEqual(['failed', 'requested']);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('filters audit events and paginates deterministically with an opaque cursor', async () => {
    const targetUserId = 'platform-audit-list-target';
    await db.insert(platformAdminOperationAudits).values([
      {
        action: 'user.profile_updated',
        occurredAt: new Date('2026-09-01T01:00:00.000Z'),
        operationId: 'platform-audit-list-profile-old',
        operatorUserId: 'platform-audit-list-admin',
        phase: 'requested',
        targetUserId,
      },
      {
        action: 'user.profile_updated',
        occurredAt: new Date('2026-09-01T02:00:00.000Z'),
        operationId: 'platform-audit-list-profile-new',
        operatorUserId: 'platform-audit-list-admin',
        phase: 'succeeded',
        targetUserId,
      },
      {
        action: 'user.banned',
        occurredAt: new Date('2026-09-01T03:00:00.000Z'),
        operationId: 'platform-audit-list-ban',
        operatorUserId: 'platform-audit-list-admin',
        phase: 'succeeded',
        targetUserId,
      },
      {
        action: 'user.profile_updated',
        occurredAt: new Date('2026-09-01T04:00:00.000Z'),
        operationId: 'platform-audit-list-other-target',
        operatorUserId: 'platform-audit-list-admin',
        phase: 'succeeded',
        targetUserId: 'platform-audit-list-other',
      },
    ]);

    const model = new PlatformAdminOperationAuditModel(db);
    const firstPage = await model.listEvents({
      action: 'user.profile_updated',
      endAt: new Date('2026-09-01T02:30:00.000Z'),
      limit: 1,
      startAt: new Date('2026-09-01T00:30:00.000Z'),
      targetUserId,
    });

    expect(firstPage.items.map(({ operationId }) => operationId)).toEqual([
      'platform-audit-list-profile-new',
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await model.listEvents({
      action: 'user.profile_updated',
      cursor: firstPage.nextCursor!,
      endAt: new Date('2026-09-01T02:30:00.000Z'),
      limit: 1,
      startAt: new Date('2026-09-01T00:30:00.000Z'),
      targetUserId,
    });
    expect(secondPage.items.map(({ operationId }) => operationId)).toEqual([
      'platform-audit-list-profile-old',
    ]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it('rejects invalid audit pagination, cursor, filter, or time ranges', async () => {
    const model = new PlatformAdminOperationAuditModel(db);

    await expect(model.listEvents({ limit: 0 })).rejects.toThrow(/limit/i);
    await expect(model.listEvents({ limit: 101 })).rejects.toThrow(/limit/i);
    await expect(model.listEvents({ cursor: '' })).rejects.toThrow(/cursor/i);
    await expect(model.listEvents({ cursor: 'not-a-valid-cursor' })).rejects.toThrow(/cursor/i);
    await expect(model.listEvents({ targetUserId: '   ' })).rejects.toThrow(/targetUserId/i);
    await expect(model.listEvents({ action: 'user.password_body_read' } as never)).rejects.toThrow(
      /action/i,
    );
    await expect(
      model.listEvents({
        endAt: new Date('2026-09-01T00:00:00.000Z'),
        startAt: new Date('2026-09-02T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/time range/i);
  });
});
