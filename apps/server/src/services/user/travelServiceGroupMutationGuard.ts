import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import {
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  isRequiredTravelServiceAgentIdentity,
} from './travelServiceGroup';

export const PLATFORM_MANAGED_TRAVEL_RESOURCE_MUTATION_FORBIDDEN =
  'This platform-managed travel resource cannot be changed';

type AgentMutationTarget = {
  actorUserId: string;
  agentIds: string[];
  kind: 'agent';
  workspaceId?: string | null;
};

type GroupMutationTarget = {
  actorUserId: string;
  groupId: string;
  kind: 'group';
  workspaceId?: string | null;
};

type MembershipMutationTarget = {
  actorUserId: string;
  agentIds: string[];
  groupId: string;
  kind: 'membership';
  operation: 'add' | 'remove' | 'update';
  role?: string;
  workspaceId?: string | null;
};

export type DefaultTravelServiceMutationTarget =
  AgentMutationTarget | GroupMutationTarget | MembershipMutationTarget;

const forbidden = (): never => {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: PLATFORM_MANAGED_TRAVEL_RESOURCE_MUTATION_FORBIDDEN,
  });
};

const workspaceMatches = (left: string | null, right: string | null) => left === right;

const getProtectedAgentIds = async (db: LobeChatDatabase, agentIds: string[]) => {
  if (agentIds.length === 0) return new Set<string>();

  const rows = await db.query.agents.findMany({
    columns: {
      agencyConfig: true,
      clientId: true,
      id: true,
      slug: true,
      userId: true,
      workspaceId: true,
    },
    where: (agents, { inArray }) => inArray(agents.id, [...new Set(agentIds)]),
  });
  if (rows.length === 0) return new Set<string>();

  const ownerIds = [...new Set(rows.map(({ userId }) => userId))];
  const defaultGroups = await db.query.chatGroups.findMany({
    columns: {
      clientId: true,
      id: true,
      userId: true,
      workspaceId: true,
    },
    where: (chatGroups, { inArray }) => inArray(chatGroups.userId, ownerIds),
  });
  const defaultGroupIds = defaultGroups
    .filter(({ clientId }) => clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID)
    .map(({ id }) => id);
  const memberships =
    defaultGroupIds.length === 0
      ? []
      : await db.query.chatGroupsAgents.findMany({
          columns: { agentId: true, chatGroupId: true, role: true },
          where: (chatGroupsAgents, { inArray }) =>
            inArray(chatGroupsAgents.chatGroupId, defaultGroupIds),
        });

  return new Set(
    rows
      .filter((agent) => {
        const matchingDefaultGroupIds = defaultGroups
          .filter(
            (group) =>
              group.userId === agent.userId &&
              workspaceMatches(group.workspaceId, agent.workspaceId) &&
              // Keep this comparison after the owner/scope checks so a forged
              // cross-user id is never classified by display text alone.
              group.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
          )
          .map(({ id }) => id);
        if (matchingDefaultGroupIds.length === 0) return false;

        const matchingMembership = memberships.find(
          (membership) =>
            membership.agentId === agent.id &&
            matchingDefaultGroupIds.includes(membership.chatGroupId),
        );

        return (
          isRequiredTravelServiceAgentIdentity({ clientId: agent.clientId }) ||
          isRequiredTravelServiceAgentIdentity({ slug: agent.slug }) ||
          matchingMembership?.role === 'supervisor' ||
          (agent.agencyConfig?.modelRuntimeMode === 'platform-managed' &&
            agent.agencyConfig.modelSelectionPolicy === 'fixed')
        );
      })
      .map(({ id }) => id),
  );
};

const getGroup = async (db: LobeChatDatabase, groupId: string) =>
  db.query.chatGroups.findFirst({
    columns: { clientId: true, id: true, userId: true, workspaceId: true },
    where: (chatGroups, { eq }) => eq(chatGroups.id, groupId),
  });

/**
 * Re-reads the target immediately before a public mutation reaches its model.
 * Classification is ID + owner + workspace based; user-facing names are never
 * trusted. Damaged agency markers remain protected so removing the marker
 * cannot become a two-step bypass.
 */
export const assertDefaultTravelServiceMutationAllowed = async (
  db: LobeChatDatabase,
  target: DefaultTravelServiceMutationTarget,
): Promise<void> => {
  if (target.kind === 'group') {
    const group = await getGroup(db, target.groupId);
    if (group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID) forbidden();
    return;
  }

  const protectedAgentIds = await getProtectedAgentIds(db, target.agentIds);
  if (protectedAgentIds.size > 0) forbidden();

  if (target.kind === 'membership') {
    const group = await getGroup(db, target.groupId);
    if (group?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID) forbidden();
  }
};

export const assertNoReservedTravelServiceIdentity = ({
  agentClientId,
  agentSlug,
  groupClientId,
}: {
  agentClientId?: string | null;
  agentSlug?: string | null;
  agentTitle?: string | null;
  groupClientId?: string | null;
}): void => {
  if (
    groupClientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID ||
    isRequiredTravelServiceAgentIdentity({ clientId: agentClientId, slug: agentSlug })
  ) {
    forbidden();
  }
};
