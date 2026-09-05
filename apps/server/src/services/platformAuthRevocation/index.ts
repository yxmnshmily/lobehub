import type { LobeChatDatabase } from '@lobechat/database';

import { auth } from '@/auth';
import { PlatformAdminOperationAuditModel } from '@/database/models/platformAdminOperationAudit';
import { revokeOIDCArtifactsByUserId } from '@/libs/oidc-provider/access-control';

export const PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE =
  'The account was blocked, but credential revocation is incomplete. Retry the operation.';

type RevocationMechanism = 'better-auth-session' | 'oidc-artifact';

interface BetterAuthRevocationContext {
  internalAdapter: {
    deleteUserSessions: (userId: string) => Promise<unknown>;
  };
}

interface PlatformAuthRevocationDependencies {
  getAuthContext?: () => Promise<BetterAuthRevocationContext>;
  revokeOIDCArtifacts?: typeof revokeOIDCArtifactsByUserId;
}

export interface PlatformAuthRevocationAuditContext {
  operationId: string;
  operatorUserId: string;
}

export class PlatformAuthRevocationError extends Error {
  readonly code = 'AUTH_REVOCATION_INCOMPLETE';

  constructor(readonly failedMechanisms: RevocationMechanism[]) {
    super(PLATFORM_AUTH_REVOCATION_RETRY_MESSAGE);
    this.name = 'PlatformAuthRevocationError';
  }
}

export class PlatformAuthRevocationService {
  private readonly getAuthContext: () => Promise<BetterAuthRevocationContext>;
  private readonly revokeOIDCArtifacts: typeof revokeOIDCArtifactsByUserId;

  constructor(
    private readonly db: LobeChatDatabase,
    dependencies: PlatformAuthRevocationDependencies = {},
  ) {
    this.getAuthContext = dependencies.getAuthContext ?? (() => auth.$context);
    this.revokeOIDCArtifacts = dependencies.revokeOIDCArtifacts ?? revokeOIDCArtifactsByUserId;
  }

  async revokeUser(
    userId: string,
    auditContext?: PlatformAuthRevocationAuditContext,
  ): Promise<void> {
    const revoke = async () => {
      const results = await Promise.allSettled([
        (async () => {
          const context = await this.getAuthContext();
          // This is the same canonical Better Auth operation used by its official
          // admin revoke endpoint, including secondary-storage cleanup.
          await context.internalAdapter.deleteUserSessions(userId);
        })(),
        this.revokeOIDCArtifacts(this.db, userId),
      ]);
      const mechanisms: RevocationMechanism[] = ['better-auth-session', 'oidc-artifact'];
      const failedMechanisms = mechanisms.filter(
        (_, index) => results[index].status === 'rejected',
      );

      if (failedMechanisms.length > 0) {
        throw new PlatformAuthRevocationError(failedMechanisms);
      }
    };

    if (!auditContext) return revoke();
    return new PlatformAdminOperationAuditModel(this.db).runOperation(
      {
        action: 'user.sessions_revoked',
        operationId: auditContext.operationId,
        operatorUserId: auditContext.operatorUserId,
        targetUserId: userId,
      },
      revoke,
    );
  }
}
