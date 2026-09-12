import type { LobeChatDatabase } from '@lobechat/database';

import { auth } from '@/auth';
import { getServerDB } from '@/database/core/db-adaptor';
import { assertOIDCUserActive } from '@/libs/oidc-provider/access-control';

type SessionHeaders = NonNullable<Parameters<typeof auth.api.getSession>[0]>['headers'];

/**
 * Resolves a Better Auth session and verifies the account against the current
 * database state. This deliberately does not trust cookie or secondary-storage
 * user snapshots, so deleted and currently banned users fail closed.
 */
export const getActiveSession = async (
  headers: SessionHeaders,
  database?: LobeChatDatabase,
): Promise<Awaited<ReturnType<typeof auth.api.getSession>> | null> => {
  try {
    const session = await auth.api.getSession({ headers });
    if (!session?.user?.id) return null;

    await assertOIDCUserActive(database ?? (await getServerDB()), session.user.id);
    return session;
  } catch {
    return null;
  }
};
