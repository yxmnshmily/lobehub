// @vitest-environment node
import { getTestInstance } from 'better-auth/test';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { platformAdminOperationAudits } from '@/database/schemas';

import {
  PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE,
  PlatformUserAccountAdministrationError,
  PlatformUserAccountAdministrationService,
  resolveManagedResetPasswordRedirect,
} from './index';

const serviceMocks = vi.hoisted(() => ({ revokeUser: vi.fn() }));

vi.mock('@/server/services/platformAuthRevocation', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    PlatformAuthRevocationService: class {
      revokeUser = serviceMocks.revokeUser;
    },
  };
});

const operatorUserId = 'platform-account-admin';
const targetUserId = 'platform-account-target';
const db = await getTestDB();

const createFixture = async () => {
  const sentResetMessages: { email: string; token: string; url: string }[] = [];
  const instance = await getTestInstance(
    {
      emailAndPassword: {
        enabled: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ token, url, user }) => {
          sentResetMessages.push({ email: user.email, token, url });
        },
      },
    },
    { disableTestUser: true },
  );
  const context = await instance.auth.$context;
  await context.internalAdapter.createUser({
    email: 'target@example.com',
    emailVerified: true,
    id: targetUserId,
    image: 'https://example.com/old.png',
    name: 'Old name',
  });
  await context.internalAdapter.createUser({
    email: 'admin@example.com',
    emailVerified: true,
    id: operatorUserId,
    name: 'Administrator',
  });
  const oldPassword = 'Old-password-123';
  await context.internalAdapter.createAccount({
    accountId: targetUserId,
    password: await context.password.hash(oldPassword),
    providerId: 'credential',
    userId: targetUserId,
  });

  const revokeUser = vi.fn().mockResolvedValue(undefined);
  const requestedRedirects: string[] = [];
  const replacementPassword = 'server-only-replacement-password-1234567890';
  const requestPasswordReset = async ({
    email,
    redirectTo,
  }: {
    email: string;
    redirectTo: string;
  }) => {
    requestedRedirects.push(redirectTo);
    return instance.auth.api.requestPasswordReset({ body: { email, redirectTo } });
  };
  const service = new PlatformUserAccountAdministrationService(db, {
    createReplacementPassword: () => replacementPassword,
    getAuthContext: async () => context,
    requestPasswordReset,
    resolveResetPasswordRedirect: (email) =>
      resolveManagedResetPasswordRedirect(email, 'https://travel.example/lobehub/'),
    revokeUser,
  });

  return {
    context,
    oldPassword,
    replacementPassword,
    requestPasswordReset,
    requestedRedirects,
    revokeUser,
    sentResetMessages,
    service,
  };
};

describe('PlatformUserAccountAdministrationService', () => {
  it('sets a hashed password, revokes sessions and never returns password material', async () => {
    const fixture = await createFixture();
    const password = 'New-password-12345';
    expect(
      await fixture.service.setPassword({
        operationId: 'admin-set-password',
        operatorUserId,
        targetUserId,
        password,
      }),
    ).toEqual({ id: targetUserId });
    const accounts = await fixture.context.internalAdapter.findAccounts(targetUserId);
    const credential = accounts.find((account) => account.providerId === 'credential');
    expect(credential?.password).not.toBe(password);
    expect(await fixture.context.password.verify({ hash: credential!.password!, password })).toBe(
      true,
    );
    expect(fixture.revokeUser).toHaveBeenCalled();
  });

  it('rejects self-targeting and short administrator passwords', async () => {
    const fixture = await createFixture();
    await expect(
      fixture.service.setPassword({
        operationId: 'invalid-password',
        operatorUserId,
        targetUserId,
        password: 'short',
      }),
    ).rejects.toThrow();
    await expect(
      fixture.service.setPassword({
        operationId: 'self-password',
        operatorUserId,
        targetUserId: operatorUserId,
        password: 'New-password-12345',
      }),
    ).rejects.toThrow();
    expect(fixture.revokeUser).not.toHaveBeenCalled();
  });

  it('forwards the audit envelope through its default session revocation dependency', async () => {
    const fixture = await createFixture();
    const operationId = 'platform-account-default-revocation-audit';
    serviceMocks.revokeUser.mockReset().mockResolvedValue(undefined);
    const service = new PlatformUserAccountAdministrationService(db, {
      getAuthContext: async () => fixture.context,
    });

    await service.updateProfile({
      fullName: 'Default revocation path',
      operationId,
      operatorUserId,
      targetUserId,
    });

    expect(serviceMocks.revokeUser).toHaveBeenCalledWith(targetUserId, {
      operationId,
      operatorUserId,
    });
  });

  it('updates only the canonical Better Auth display name/avatar fields and returns a safe projection', async () => {
    const fixture = await createFixture();
    const operationId = 'platform-account-profile-success';

    const result = await fixture.service.updateProfile({
      avatar: 'https://example.com/new.png',
      fullName: '新姓名',
      operationId,
      operatorUserId,
      targetUserId,
    });

    expect(result).toEqual({
      avatar: 'https://example.com/new.png',
      fullName: '新姓名',
      id: targetUserId,
    });
    expect(Object.keys(result).sort()).toEqual(['avatar', 'fullName', 'id']);
    expect(fixture.revokeUser).toHaveBeenCalledOnce();
    expect(fixture.revokeUser).toHaveBeenCalledWith(targetUserId, {
      operationId,
      operatorUserId,
    });
    const updated = await fixture.context.internalAdapter.findUserById(targetUserId);
    expect(updated).toMatchObject({ image: 'https://example.com/new.png', name: '新姓名' });
    expect(JSON.stringify(result)).not.toMatch(/email|password|token|provider/i);
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.profile_updated', phase: 'requested' },
      { action: 'user.profile_updated', phase: 'succeeded' },
    ]);
    expect(JSON.stringify(auditEvents)).not.toMatch(/new\.png|新姓名|email|password|token|ip/i);
  });

  it('sends the canonical one-time reset link, revokes sessions, then invalidates the old password', async () => {
    const fixture = await createFixture();
    const operationId = 'platform-account-reset-success';

    const result = await fixture.service.forcePasswordReset({
      operationId,
      operatorUserId,
      targetUserId,
    });

    expect(result).toEqual({ id: targetUserId, resetRequested: true });
    expect(Object.keys(result).sort()).toEqual(['id', 'resetRequested']);
    expect(fixture.sentResetMessages).toHaveLength(1);
    expect(fixture.sentResetMessages[0]).toMatchObject({ email: 'target@example.com' });
    expect(fixture.requestedRedirects).toEqual([
      'https://travel.example/lobehub/reset-password?email=target%40example.com',
    ]);
    expect(fixture.sentResetMessages[0].url).toContain(fixture.sentResetMessages[0].token);
    expect(fixture.revokeUser).toHaveBeenCalledWith(targetUserId, {
      operationId,
      operatorUserId,
    });

    const credential = (await fixture.context.internalAdapter.findAccounts(targetUserId)).find(
      ({ providerId }) => providerId === 'credential',
    );
    expect(credential?.password).toBeTruthy();
    await expect(
      fixture.context.password.verify({
        hash: credential!.password!,
        password: fixture.oldPassword,
      }),
    ).resolves.toBe(false);
    await expect(
      fixture.context.password.verify({
        hash: credential!.password!,
        password: fixture.replacementPassword,
      }),
    ).resolves.toBe(true);
    expect(JSON.stringify(result)).not.toContain(fixture.replacementPassword);
    expect(JSON.stringify(result)).not.toContain(fixture.sentResetMessages[0].token);
    const auditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, operationId));
    expect(auditEvents.map(({ action, phase }) => ({ action, phase }))).toEqual([
      { action: 'user.password_reset_requested', phase: 'requested' },
      { action: 'user.password_reset_requested', phase: 'succeeded' },
    ]);
    const serializedAudit = JSON.stringify(auditEvents);
    expect(serializedAudit).not.toContain('target@example.com');
    expect(serializedAudit).not.toContain(fixture.replacementPassword);
    expect(serializedAudit).not.toContain(fixture.sentResetMessages[0].token);
    expect(serializedAudit).not.toContain(fixture.sentResetMessages[0].url);
  });

  it('refuses every self-targeting operation before sending mail, changing profile, or revoking sessions', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.service.updateProfile({
        fullName: 'Locked admin',
        operationId: 'platform-account-self-profile',
        operatorUserId,
        targetUserId: operatorUserId,
      }),
    ).rejects.toEqual(
      new PlatformUserAccountAdministrationError(
        'SELF_OPERATION_FORBIDDEN',
        'Administrators must use their personal account settings for their own profile',
      ),
    );
    await expect(
      fixture.service.forcePasswordReset({
        operationId: 'platform-account-self-reset',
        operatorUserId,
        targetUserId: operatorUserId,
      }),
    ).rejects.toMatchObject({ code: 'SELF_OPERATION_FORBIDDEN' });
    expect(fixture.sentResetMessages).toHaveLength(0);
    expect(fixture.revokeUser).not.toHaveBeenCalled();
    await expect(
      fixture.context.internalAdapter.findUserById(operatorUserId),
    ).resolves.toMatchObject({ name: 'Administrator' });
  });

  it('does not invalidate the password when canonical reset delivery or session revocation fails', async () => {
    const fixture = await createFixture();
    const resetFailureService = new PlatformUserAccountAdministrationService(db, {
      createReplacementPassword: () => fixture.replacementPassword,
      getAuthContext: async () => fixture.context,
      requestPasswordReset: async () => {
        throw new Error('SMTP_CREDENTIAL_MUST_NOT_LEAK');
      },
      revokeUser: fixture.revokeUser,
    });

    const resetFailureOperationId = 'platform-account-reset-mail-failed';
    const resetPromise = resetFailureService.forcePasswordReset({
      operationId: resetFailureOperationId,
      operatorUserId,
      targetUserId,
    });
    await expect(resetPromise).rejects.toThrow(PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE);
    expect(JSON.stringify(await resetPromise.catch((error) => error))).not.toContain(
      'SMTP_CREDENTIAL_MUST_NOT_LEAK',
    );
    expect(fixture.revokeUser).not.toHaveBeenCalled();
    const resetAuditEvents = await db
      .select()
      .from(platformAdminOperationAudits)
      .where(eq(platformAdminOperationAudits.operationId, resetFailureOperationId));
    expect(resetAuditEvents.map(({ phase }) => phase)).toEqual(['requested', 'failed']);
    expect(JSON.stringify(resetAuditEvents)).not.toContain('SMTP_CREDENTIAL_MUST_NOT_LEAK');

    const revocationFailureService = new PlatformUserAccountAdministrationService(db, {
      createReplacementPassword: () => fixture.replacementPassword,
      getAuthContext: async () => fixture.context,
      requestPasswordReset: fixture.requestPasswordReset,
      resolveResetPasswordRedirect: (email) =>
        resolveManagedResetPasswordRedirect(email, 'https://travel.example/lobehub/'),
      revokeUser: async () => {
        throw new Error('SESSION_TOKEN_MUST_NOT_LEAK');
      },
    });
    const revokePromise = revocationFailureService.forcePasswordReset({
      operationId: 'platform-account-reset-revoke-failed',
      operatorUserId,
      targetUserId,
    });
    await expect(revokePromise).rejects.toThrow(PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE);
    expect(JSON.stringify(await revokePromise.catch((error) => error))).not.toContain(
      'SESSION_TOKEN_MUST_NOT_LEAK',
    );

    const credential = (await fixture.context.internalAdapter.findAccounts(targetUserId)).find(
      ({ providerId }) => providerId === 'credential',
    );
    await expect(
      fixture.context.password.verify({
        hash: credential!.password!,
        password: fixture.oldPassword,
      }),
    ).resolves.toBe(true);
  });

  it('does not partially update a profile when session revocation fails', async () => {
    const fixture = await createFixture();
    const service = new PlatformUserAccountAdministrationService(db, {
      getAuthContext: async () => fixture.context,
      revokeUser: async () => {
        throw new Error('REDIS_SESSION_TOKEN_MUST_NOT_LEAK');
      },
    });

    const promise = service.updateProfile({
      avatar: 'https://example.com/should-not-be-saved.png',
      fullName: 'Should not be saved',
      operationId: 'platform-account-profile-revoke-failed',
      operatorUserId,
      targetUserId,
    });

    await expect(promise).rejects.toThrow(PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE);
    expect(JSON.stringify(await promise.catch((error) => error))).not.toContain(
      'REDIS_SESSION_TOKEN_MUST_NOT_LEAK',
    );
    await expect(fixture.context.internalAdapter.findUserById(targetUserId)).resolves.toMatchObject(
      { image: 'https://example.com/old.png', name: 'Old name' },
    );
  });

  it('rejects unsafe profile fields in the service before calling Better Auth', async () => {
    const fixture = await createFixture();

    for (const [index, avatar] of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `https://example.com/${'a'.repeat(2048)}`,
    ].entries()) {
      await expect(
        fixture.service.updateProfile({
          avatar,
          operationId: `platform-account-invalid-avatar-${index}`,
          operatorUserId,
          targetUserId,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    }
    for (const [index, fullName] of [
      '   ',
      'Line\nBreak',
      `Name${String.fromCharCode(0)}Hidden`,
      'a'.repeat(101),
    ].entries()) {
      await expect(
        fixture.service.updateProfile({
          fullName,
          operationId: `platform-account-invalid-name-${index}`,
          operatorUserId,
          targetUserId,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_PROFILE' });
    }

    expect(fixture.revokeUser).not.toHaveBeenCalled();
    await expect(fixture.context.internalAdapter.findUserById(targetUserId)).resolves.toMatchObject(
      { image: 'https://example.com/old.png', name: 'Old name' },
    );
  });
});
