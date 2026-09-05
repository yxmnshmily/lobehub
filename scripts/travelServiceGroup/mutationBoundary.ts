import { readFile } from 'node:fs/promises';

import {
  auditTravelMutationBoundaries,
  summarizeTravelMutationBoundaries,
} from './mutationBoundaryCore';

const sourcePaths = {
  agentGroupRouter: 'apps/server/src/routers/lambda/agentGroup.ts',
  agentRouter: 'apps/server/src/routers/lambda/agent.ts',
  platformAdminGuard: 'apps/server/src/routers/lambda/_helpers/platformAdminGuard.ts',
} as const;

const main = async () => {
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(sourcePaths).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
    ),
  ) as Record<keyof typeof sourcePaths, string>;
  const summary = summarizeTravelMutationBoundaries(auditTravelMutationBoundaries(sources));

  console.log(JSON.stringify(summary, null, 2));
  if (summary.ordinaryUserMutableCount > 0) process.exitCode = 2;
};

void main().catch(() => {
  console.error('Travel service group mutation boundary audit failed');
  process.exitCode = 1;
});
