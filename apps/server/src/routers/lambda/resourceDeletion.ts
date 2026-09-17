import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { ResourceDeletionService } from '@/server/services/resourceDeletion';

const procedure = wsCompatProcedure.use(serverDatabase).use(withScopedPermission('agent:update'));
const selection = z.object({
  resource: z.enum(['goal', 'task', 'project']),
  ids: z.array(z.string().min(1)).min(1),
});

export const resourceDeletionRouter = router({
  preview: procedure
    .input(selection)
    .query(({ ctx, input }) =>
      new ResourceDeletionService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
        ctx.workspaceRole,
      ).preview(input.resource, input.ids),
    ),
  delete: procedure
    .input(selection.extend({ snapshot: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ({
      success: true,
      deletion: await new ResourceDeletionService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
        ctx.workspaceRole,
      ).delete(input.resource, input.ids, input.snapshot),
    })),
  retryPendingCleanup: procedure.mutation(async ({ ctx }) => ({
    storageCleanups: await new ResourceDeletionService(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId ?? undefined,
      ctx.workspaceRole,
    ).retryPendingCleanup(),
  })),
  retryCleanup: procedure
    .input(z.object({ jobId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => ({
      storageCleanup: await new ResourceDeletionService(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId ?? undefined,
        ctx.workspaceRole,
      ).retryCleanup(input.jobId),
    })),
});
