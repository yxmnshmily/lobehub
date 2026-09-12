import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { headers } from 'next/headers';
import { z } from 'zod';

import { authEnv } from '@/envs/auth';
import { getActiveSession } from '@/libs/better-auth/getActiveSession';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  UserSessionManagementError,
  UserSessionManagementService,
} from '@/server/services/userSessionManagement';

const revokeSessionInput = z.object({ sessionId: z.string().regex(/^[\w-]{43}$/) }).strict();

const throwSafeSessionError: (error: unknown) => never = (error) => {
  if (!(error instanceof UserSessionManagementError)) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Session operation is unavailable',
    });
  }

  switch (error.code) {
    case 'CURRENT_SESSION_PROTECTED': {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'The current session is protected' });
    }
    case 'INVALID_AUTH_CONTEXT': {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Authenticated session is unavailable',
      });
    }
    case 'SESSION_UNAVAILABLE': {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Session is unavailable' });
    }
    case 'INVALID_OPAQUE_ID_SECRET':
    case 'SESSION_REVOCATION_FAILED': {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Session operation is unavailable',
      });
    }
  }
};

const createCurrentUserService = async (ctx: { serverDB: LobeChatDatabase; userId: string }) => {
  let session;
  try {
    session = await getActiveSession(await headers(), ctx.serverDB);
  } catch {
    session = null;
  }

  if (!session?.session?.token || session.user.id !== ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authenticated session is unavailable' });
  }

  try {
    return new UserSessionManagementService(ctx.serverDB, {
      actorUserId: ctx.userId,
      currentSessionToken: session.session.token,
      opaqueIdSecret: authEnv.AUTH_SECRET ?? '',
    });
  } catch (error) {
    throwSafeSessionError(error);
  }
};

const currentUserProcedure = authedProcedure.use(serverDatabase);

export const userSessionManagementRouter = router({
  listSessions: currentUserProcedure.input(z.undefined()).query(async ({ ctx }) => {
    const service = await createCurrentUserService(ctx);
    try {
      return await service.listSessions();
    } catch (error) {
      throwSafeSessionError(error);
    }
  }),

  revokeSession: currentUserProcedure.input(revokeSessionInput).mutation(async ({ ctx, input }) => {
    const service = await createCurrentUserService(ctx);
    try {
      return await service.revokeSession(input.sessionId);
    } catch (error) {
      throwSafeSessionError(error);
    }
  }),
});
