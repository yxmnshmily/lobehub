import { randomBytes } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';

import { auth } from '@/auth';
import { PlatformAdminOperationAuditModel } from '@/database/models/platformAdminOperationAudit';
import { appEnv } from '@/envs/app';
import {
  type PlatformAuthRevocationAuditContext,
  PlatformAuthRevocationService,
} from '@/server/services/platformAuthRevocation';

export const PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE =
  'The account operation could not be completed safely. Retry the operation.';

export type PlatformUserAccountAdministrationErrorCode =
  | 'EMAIL_UNAVAILABLE'
  | 'INVALID_PROFILE'
  | 'OPERATION_FAILED'
  | 'SELF_OPERATION_FORBIDDEN'
  | 'USER_NOT_FOUND';

export class PlatformUserAccountAdministrationError extends Error {
  constructor(
    readonly code: PlatformUserAccountAdministrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformUserAccountAdministrationError';
  }
}

interface BetterAuthUserProjection {
  email: string;
  id: string;
  image?: null | string;
  name: string;
}

interface BetterAuthAccountProjection {
  providerId: string;
}

interface BetterAuthAdministrationContext {
  internalAdapter: {
    findAccounts: (userId: string) => Promise<BetterAuthAccountProjection[]>;
    findUserById: (userId: string) => Promise<BetterAuthUserProjection | null>;
    updatePassword: (userId: string, passwordHash: string) => Promise<void>;
    updateUser: (
      userId: string,
      data: { image?: null | string; name?: string },
    ) => Promise<BetterAuthUserProjection>;
  };
  password: {
    hash: (password: string) => Promise<string>;
  };
}

interface PlatformUserAccountAdministrationDependencies {
  createReplacementPassword?: () => string;
  getAuthContext?: () => Promise<BetterAuthAdministrationContext>;
  requestPasswordReset?: (input: {
    email: string;
    redirectTo: string;
  }) => Promise<{ status: boolean }>;
  resolveResetPasswordRedirect?: (email: string) => string;
  revokeUser?: (userId: string, auditContext?: PlatformAuthRevocationAuditContext) => Promise<void>;
}

export interface UpdateManagedUserProfileInput {
  avatar?: null | string;
  fullName?: string;
  operationId: string;
  operatorUserId: string;
  targetUserId: string;
}

export interface ForceManagedUserPasswordResetInput {
  operationId: string;
  operatorUserId: string;
  targetUserId: string;
}

const createReplacementPassword = () => randomBytes(48).toString('base64url');

const normalizeFullName = (value: string): string => {
  const fullName = value.trim();
  if (!fullName || Array.from(fullName).length > 100 || /[\p{Cc}\p{Cf}]/u.test(fullName)) {
    throw new PlatformUserAccountAdministrationError('INVALID_PROFILE', 'Display name is invalid');
  }
  return fullName;
};

const normalizeAvatar = (value: null | string): null | string => {
  if (value === null) return null;
  const avatar = value.trim();
  if (!avatar || avatar.length > 2048) {
    throw new PlatformUserAccountAdministrationError('INVALID_PROFILE', 'Avatar URL is invalid');
  }
  try {
    const url = new URL(avatar);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      Boolean(url.username) ||
      Boolean(url.password)
    ) {
      throw new Error('unsupported-avatar-url');
    }
  } catch {
    throw new PlatformUserAccountAdministrationError('INVALID_PROFILE', 'Avatar URL is invalid');
  }
  return avatar;
};

export const resolveManagedResetPasswordRedirect = (email: string, appUrl = appEnv.APP_URL) => {
  const url = new URL('reset-password', `${appUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('email', email);
  return url.toString();
};

const assertNotSelfTargeting = (operatorUserId: string, targetUserId: string) => {
  if (operatorUserId === targetUserId) {
    throw new PlatformUserAccountAdministrationError(
      'SELF_OPERATION_FORBIDDEN',
      'Administrators must use their personal account settings for their own profile',
    );
  }
};

const wrapAccountAdministrationError: (error: unknown) => never = (error) => {
  if (error instanceof PlatformUserAccountAdministrationError) throw error;
  throw new PlatformUserAccountAdministrationError(
    'OPERATION_FAILED',
    PLATFORM_USER_ACCOUNT_ADMIN_RETRY_MESSAGE,
  );
};

/**
 * Performs administrator account changes through Better Auth's canonical
 * adapter/password APIs. The service deliberately returns projections that
 * cannot contain email delivery tokens, password material or auth providers.
 */
export class PlatformUserAccountAdministrationService {
  private readonly audit: PlatformAdminOperationAuditModel;
  private readonly createReplacementPassword: () => string;
  private readonly getAuthContext: () => Promise<BetterAuthAdministrationContext>;
  private readonly requestPasswordReset: NonNullable<
    PlatformUserAccountAdministrationDependencies['requestPasswordReset']
  >;
  private readonly resolveResetPasswordRedirect: (email: string) => string;
  private readonly revokeUser: NonNullable<
    PlatformUserAccountAdministrationDependencies['revokeUser']
  >;

  constructor(
    db: LobeChatDatabase,
    dependencies: PlatformUserAccountAdministrationDependencies = {},
  ) {
    this.audit = new PlatformAdminOperationAuditModel(db);
    this.createReplacementPassword =
      dependencies.createReplacementPassword ?? createReplacementPassword;
    this.getAuthContext =
      dependencies.getAuthContext ??
      (() => auth.$context as Promise<BetterAuthAdministrationContext>);
    this.requestPasswordReset =
      dependencies.requestPasswordReset ??
      (({ email, redirectTo }) => auth.api.requestPasswordReset({ body: { email, redirectTo } }));
    this.resolveResetPasswordRedirect =
      dependencies.resolveResetPasswordRedirect ?? resolveManagedResetPasswordRedirect;
    this.revokeUser =
      dependencies.revokeUser ??
      ((userId, auditContext) =>
        new PlatformAuthRevocationService(db).revokeUser(userId, auditContext));
  }

  async updateProfile(input: UpdateManagedUserProfileInput): Promise<{
    avatar: null | string;
    fullName: string;
    id: string;
  }> {
    try {
      assertNotSelfTargeting(input.operatorUserId, input.targetUserId);
      const hasFullName = input.fullName !== undefined;
      const hasAvatar = input.avatar !== undefined;
      if (!hasFullName && !hasAvatar) {
        throw new PlatformUserAccountAdministrationError(
          'INVALID_PROFILE',
          'At least one profile field is required',
        );
      }
      const profileUpdate = {
        ...(hasAvatar ? { image: normalizeAvatar(input.avatar!) } : {}),
        ...(hasFullName ? { name: normalizeFullName(input.fullName!) } : {}),
      };

      const context = await this.getAuthContext();
      const target = await context.internalAdapter.findUserById(input.targetUserId);
      if (!target) {
        throw new PlatformUserAccountAdministrationError(
          'USER_NOT_FOUND',
          'Target user was not found',
        );
      }

      // Revoke first so a revocation failure cannot leave a partially updated
      // profile attached to still-active Better Auth, Redis or OIDC sessions.
      return await this.audit.runOperation(
        {
          action: 'user.profile_updated',
          operationId: input.operationId,
          operatorUserId: input.operatorUserId,
          targetUserId: input.targetUserId,
        },
        async () => {
          await this.revokeUser(input.targetUserId, {
            operationId: input.operationId,
            operatorUserId: input.operatorUserId,
          });
          const updated = await context.internalAdapter.updateUser(
            input.targetUserId,
            profileUpdate,
          );

          return {
            avatar: updated.image ?? null,
            fullName: updated.name,
            id: updated.id,
          };
        },
      );
    } catch (error) {
      wrapAccountAdministrationError(error);
    }
  }

  async forcePasswordReset(input: ForceManagedUserPasswordResetInput): Promise<{
    id: string;
    resetRequested: true;
  }> {
    try {
      assertNotSelfTargeting(input.operatorUserId, input.targetUserId);
      const context = await this.getAuthContext();
      const target = await context.internalAdapter.findUserById(input.targetUserId);
      if (!target) {
        throw new PlatformUserAccountAdministrationError(
          'USER_NOT_FOUND',
          'Target user was not found',
        );
      }
      if (!target.email) {
        throw new PlatformUserAccountAdministrationError(
          'EMAIL_UNAVAILABLE',
          'Target user has no reset email address',
        );
      }

      return await this.audit.runOperation(
        {
          action: 'user.password_reset_requested',
          operationId: input.operationId,
          operatorUserId: input.operatorUserId,
          targetUserId: input.targetUserId,
        },
        async () => {
          const reset = await this.requestPasswordReset({
            email: target.email,
            redirectTo: this.resolveResetPasswordRedirect(target.email),
          });
          if (!reset.status) throw new Error('password-reset-not-dispatched');

          // Do not invalidate the known password unless all active application,
          // secondary-storage and OIDC sessions have been revoked successfully.
          await this.revokeUser(input.targetUserId, {
            operationId: input.operationId,
            operatorUserId: input.operatorUserId,
          });

          const accounts = await context.internalAdapter.findAccounts(input.targetUserId);
          if (accounts.some(({ providerId }) => providerId === 'credential')) {
            const replacement = this.createReplacementPassword();
            const replacementHash = await context.password.hash(replacement);
            await context.internalAdapter.updatePassword(input.targetUserId, replacementHash);
          }

          return { id: input.targetUserId, resetRequested: true as const };
        },
      );
    } catch (error) {
      wrapAccountAdministrationError(error);
    }
  }

  async setPassword(
    input: ForceManagedUserPasswordResetInput & { password: string },
  ): Promise<{ id: string }> {
    try {
      assertNotSelfTargeting(input.operatorUserId, input.targetUserId);
      if (input.password.length < 12 || input.password.length > 128) {
        throw new PlatformUserAccountAdministrationError(
          'INVALID_PROFILE',
          '密码须为 12–128 个字符',
        );
      }
      const context = await this.getAuthContext();
      const accounts = await context.internalAdapter.findAccounts(input.targetUserId);
      if (!accounts.some(({ providerId }) => providerId === 'credential')) {
        throw new PlatformUserAccountAdministrationError(
          'INVALID_PROFILE',
          '该用户未设置密码登录，请使用邮件重置入口',
        );
      }
      const hash = await context.password.hash(input.password);
      return await this.audit.runOperation(
        {
          action: 'user.password_reset_requested',
          operationId: input.operationId,
          operatorUserId: input.operatorUserId,
          targetUserId: input.targetUserId,
        },
        async () => {
          await this.revokeUser(input.targetUserId);
          await context.internalAdapter.updatePassword(input.targetUserId, hash);
          await this.revokeUser(input.targetUserId);
          return { id: input.targetUserId };
        },
      );
    } catch (error) {
      wrapAccountAdministrationError(error);
    }
  }
}
