import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withRbacPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { DataImporterRepos } from '@/database/repositories/dataImporter';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { FileService } from '@/server/services/file';
import { type ImportPgDataStructure } from '@/types/export';
import { type ImporterEntryData, type ImportResultData } from '@/types/importer';

import { hasActivePlatformAdminAccess } from './_helpers/platformAdminGuard';

const importProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      dataImporterService: new DataImporterRepos(ctx.serverDB, ctx.userId, wsId),
      fileService: new FileService(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

// Whole-workspace migration is reserved for the unique Owner.
const workspaceImportProcedure = importProcedure.use(withRbacPermission('workspace:delete:all'));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const PLATFORM_CONFIGURATION_TABLES = new Set([
  'agentSkills',
  'agentTools',
  'agents',
  'agentsFiles',
  'agentsKnowledgeBases',
  'agentsToSessions',
  'aiModels',
  'aiProviders',
  'chatGroups',
  'chatGroupsAgents',
  'userInstalledPlugins',
]);

const PLATFORM_USER_SETTING_FIELDS = [
  'defaultAgent',
  'image',
  'keyVaults',
  'languageModel',
  'market',
  'systemAgent',
  'tool',
];

const hasRows = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0;

const containsPlatformConfiguration = (payload: unknown): boolean => {
  const payloadRecord = asRecord(payload);
  if (!payloadRecord) return false;
  const data = asRecord(payloadRecord.data) ?? payloadRecord;

  if ('schemaHash' in payloadRecord) {
    for (const [table, rows] of Object.entries(data)) {
      if (PLATFORM_CONFIGURATION_TABLES.has(table) && hasRows(rows)) return true;
    }

    return hasRows(data.userSettings)
      ? data.userSettings.some((row) => {
          const settings = asRecord(row);
          return settings ? PLATFORM_USER_SETTING_FIELDS.some((field) => field in settings) : false;
        })
      : false;
  }

  // Every legacy session embeds an agent config/meta pair and the importer
  // creates a new agent row for it. Messages, topics and folders alone remain
  // ordinary personal-content imports.
  return hasRows(data.sessions);
};

const assertImportAllowed = async (
  db: Parameters<typeof hasActivePlatformAdminAccess>[0],
  userId: string,
  payload: unknown,
) => {
  if (!containsPlatformConfiguration(payload)) return;
  if (await hasActivePlatformAdminAccess(db, userId)) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Platform administrator access is required to import platform configuration',
  });
};

export const importerRouter = router({
  importByFile: workspaceImportProcedure
    .input(z.object({ pathname: z.string() }))
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      let data: ImporterEntryData | undefined;

      try {
        const dataStr = await ctx.fileService.getFileContent(input.pathname);
        data = JSON.parse(dataStr);
      } catch {
        data = undefined;
      }

      if (!data) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to read file at ${input.pathname}`,
        });
      }

      await assertImportAllowed(ctx.serverDB, ctx.userId, data);
      let result: ImportResultData;
      if ('schemaHash' in data) {
        result = await ctx.dataImporterService.importPgData(
          data as unknown as ImportPgDataStructure,
        );
      } else {
        result = await ctx.dataImporterService.importData(data);
      }

      // clean file after upload
      await ctx.fileService.deleteFile(input.pathname);

      return result;
    }),

  importByPost: workspaceImportProcedure
    .input(
      z.object({
        data: z.object({
          messages: z.array(z.any()).optional(),
          sessionGroups: z.array(z.any()).optional(),
          sessions: z.array(z.any()).optional(),
          topics: z.array(z.any()).optional(),
          version: z.number(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      await assertImportAllowed(ctx.serverDB, ctx.userId, input.data);
      return ctx.dataImporterService.importData(input.data);
    }),
  importPgByPost: workspaceImportProcedure
    .input(
      z.object({
        data: z.record(z.string(), z.array(z.any())),
        mode: z.enum(['pglite', 'postgres']),
        schemaHash: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ImportResultData> => {
      await assertImportAllowed(ctx.serverDB, ctx.userId, input);
      return ctx.dataImporterService.importPgData(input);
    }),
});
