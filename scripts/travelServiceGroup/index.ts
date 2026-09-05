import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { eq } from 'drizzle-orm';

import {
  parseTravelGroupCommandArgs,
  runTravelGroupCommand,
  summarizeTravelGroupCommandResult,
} from './core';

const environment = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}.local` }));

const fail = (message: string): never => {
  console.error(`Travel service group command failed: ${message}`);
  process.exit(1);
};

const main = async () => {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not configured');
  let args;
  try {
    args = parseTravelGroupCommandArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const [{ serverDB }, { users }, service] = await Promise.all([
    import('../../packages/database/src/server'),
    import('../../packages/database/src/schemas/user'),
    import('../../apps/server/src/services/user/travelServiceGroup'),
  ]);

  const result = await runTravelGroupCommand(args, {
    bootstrap: async (userId) => {
      await service.initDefaultTravelServiceGroup(serverDB, userId);
    },
    check: (userId) => service.checkDefaultTravelServiceGroup(serverDB, userId),
    userExists: async (userId) =>
      !!(await serverDB.query.users.findFirst({
        columns: { id: true },
        where: eq(users.id, userId),
      })),
  });

  console.log(
    JSON.stringify(
      summarizeTravelGroupCommandResult(args.userId, result as unknown as Record<string, unknown>),
      null,
      2,
    ),
  );
  if (!result.ready) process.exitCode = 2;
};

void main().catch(() => fail('operation failed'));
