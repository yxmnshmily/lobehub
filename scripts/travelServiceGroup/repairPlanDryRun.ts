import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { and, eq, lte, or } from 'drizzle-orm';

import { parseTravelGroupRepairPlanDryRunArgs, summarizeTravelGroupRepairPlanDryRun } from './core';

const environment = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config({ quiet: true }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}`, quiet: true }));
dotenvExpand.expand(
  dotenv.config({ override: true, path: `.env.${environment}.local`, quiet: true }),
);

const main = async () => {
  parseTravelGroupRepairPlanDryRunArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

  const [{ serverDB }, { users }, service] = await Promise.all([
    import('../../packages/database/src/server'),
    import('../../packages/database/src/schemas/user'),
    import('../../apps/server/src/services/user/travelServiceGroup'),
  ]);
  const now = new Date();
  const eligibleUsers = await serverDB.query.users.findMany({
    columns: { id: true },
    where: and(
      eq(users.emailVerified, true),
      or(eq(users.banned, false), lte(users.banExpires, now)),
    ),
  });
  const plans = [];
  for (const { id: targetUserId } of eligibleUsers) {
    const health = await service.getDefaultTravelServiceGroupHealthSummary(serverDB, {
      targetUserId,
    });
    plans.push(service.buildDefaultTravelServiceGroupRepairPlan(health));
  }

  console.log(JSON.stringify(summarizeTravelGroupRepairPlanDryRun(plans), null, 2));
};

void main().catch(() => {
  console.error('Travel service group repair plan dry-run failed');
  process.exitCode = 1;
});
