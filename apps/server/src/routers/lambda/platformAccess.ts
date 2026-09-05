import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { hasActivePlatformAdminAccess } from './_helpers/platformAdminGuard';

export const platformAccessRouter = router({
  isPlatformAdmin: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    return hasActivePlatformAdminAccess(ctx.serverDB, ctx.userId);
  }),
});
