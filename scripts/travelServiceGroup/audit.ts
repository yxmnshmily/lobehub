import * as dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import { and, eq, lte, or } from 'drizzle-orm';

import {
  hasPlatformManagedIdentityAnomaly,
  parseTravelGroupAuditArgs,
  runTravelGroupIntegrityAudit,
  safeAuditFailureMessage,
} from './auditCore';

const environment = process.env.NODE_ENV || 'development';
dotenvExpand.expand(dotenv.config());
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}` }));
dotenvExpand.expand(dotenv.config({ override: true, path: `.env.${environment}.local` }));

const main = async () => {
  const { repair } = parseTravelGroupAuditArgs(process.argv.slice(2));
  if (repair) throw new Error('Repair mode is not implemented; no writes were performed');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  const [{ serverDB }, schema, service] = await Promise.all([
    import('../../packages/database/src/server'),
    import('../../packages/database/src/schemas'),
    import('../../apps/server/src/services/user/travelServiceGroup'),
  ]);
  const { agents, chatGroups, chatGroupsAgents, users } = schema;

  const specialistClientIds = new Set(
    service.TRAVEL_SPECIALIST_TEMPLATES.map(({ clientId }) => clientId),
  );
  const summary = await runTravelGroupIntegrityAudit({
    inspect: async (scopedUserId) => {
      const defaultGroups = await serverDB
        .select({ id: chatGroups.id, visibility: chatGroups.visibility })
        .from(chatGroups)
        .where(
          and(
            eq(chatGroups.clientId, service.DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
            eq(chatGroups.userId, scopedUserId),
          ),
        );
      const relationRows = await serverDB
        .select({
          agentClientId: agents.clientId,
          agentTitle: agents.title,
          agentUserId: agents.userId,
          enabled: chatGroupsAgents.enabled,
          groupUserId: chatGroups.userId,
          relationUserId: chatGroupsAgents.userId,
          role: chatGroupsAgents.role,
        })
        .from(chatGroupsAgents)
        .innerJoin(chatGroups, eq(chatGroups.id, chatGroupsAgents.chatGroupId))
        .innerJoin(agents, eq(agents.id, chatGroupsAgents.agentId))
        .where(
          and(
            eq(chatGroups.clientId, service.DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID),
            eq(chatGroups.userId, scopedUserId),
          ),
        );
      const check = await service.checkDefaultTravelServiceGroup(serverDB, scopedUserId);
      const supervisors = relationRows.filter(({ role }) => role === 'supervisor');

      return {
        crossUserBindingCount: relationRows.filter(
          ({ agentUserId, groupUserId, relationUserId }) =>
            agentUserId !== groupUserId || relationUserId !== groupUserId,
        ).length,
        defaultGroupCount: defaultGroups.length,
        groupVisibility: defaultGroups.some(({ visibility }) => visibility !== 'private')
          ? 'public'
          : (defaultGroups[0]?.visibility ?? null),
        missingOrDisabledRequiredMemberCount: [...specialistClientIds].filter(
          (clientId) =>
            !relationRows.some(
              ({ agentClientId, enabled, role }) =>
                agentClientId === clientId && enabled === true && role === 'participant',
            ),
        ).length,
        platformManagedIdentityAbnormal: hasPlatformManagedIdentityAnomaly(check),
        supervisorCount: supervisors.length,
        supervisorTitle: supervisors.length === 1 ? supervisors[0].agentTitle : null,
      };
    },
    listEligibleUserIds: async () => {
      const now = new Date();
      const eligibleUsers = await serverDB.query.users.findMany({
        columns: { id: true },
        where: and(
          eq(users.emailVerified, true),
          or(eq(users.banned, false), lte(users.banExpires, now)),
        ),
      });
      return eligibleUsers.map(({ id }) => id);
    },
  });

  console.log(JSON.stringify({ readOnly: true, ...summary }, null, 2));
};

void main().catch((error) => {
  console.error(safeAuditFailureMessage(error));
  process.exitCode = 1;
});
