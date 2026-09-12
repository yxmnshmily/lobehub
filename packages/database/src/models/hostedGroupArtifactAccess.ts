import { and, eq, isNull, sql } from 'drizzle-orm';

import { agentOperations } from '../schemas/agentOperations';
import { chatGroups } from '../schemas/chatGroup';
import { chatGroupUserMemberships } from '../schemas/chatGroupUserMembership';
import type { LobeChatDatabase } from '../type';

export type HostedGroupArtifactKind = 'document' | 'text';

export interface HostedGroupArtifactAccessMarker {
  actorUserIdSnapshot: string;
  artifactInternalId: string;
  artifactKind: HostedGroupArtifactKind;
  expiresAt: string;
  groupId: string;
  handleHash: string;
  membershipVersion: number;
  operationId: string;
  ownerUserIdSnapshot: string;
  publishedAt: string;
  version: 1;
}

export interface HostedGroupArtifactAccessCandidate {
  marker: unknown;
  operationGroupId: string | null;
  operationId: string;
  operationOwnerUserId: string;
  readerJoinedAt: Date;
  readerMembershipVersion: number;
}

const canonicalText = (value: string, maxLength = 512) =>
  Boolean(value) && value.trim() === value && value.length <= maxLength;

const canonicalTimestamp = (value: string) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : undefined;
};

const normalizeMarker = (
  input: HostedGroupArtifactAccessMarker,
): HostedGroupArtifactAccessMarker | undefined => {
  const publishedAt = canonicalTimestamp(input.publishedAt);
  const expiresAt = canonicalTimestamp(input.expiresAt);
  if (
    input.version !== 1 ||
    !canonicalText(input.actorUserIdSnapshot, 255) ||
    !canonicalText(input.ownerUserIdSnapshot, 255) ||
    input.actorUserIdSnapshot === input.ownerUserIdSnapshot ||
    !canonicalText(input.groupId, 255) ||
    !canonicalText(input.operationId, 255) ||
    !canonicalText(input.artifactInternalId) ||
    (input.artifactKind !== 'text' && input.artifactKind !== 'document') ||
    !/^[a-f\d]{64}$/.test(input.handleHash) ||
    !Number.isSafeInteger(input.membershipVersion) ||
    input.membershipVersion <= 0 ||
    publishedAt === undefined ||
    expiresAt === undefined ||
    publishedAt > Date.now() ||
    expiresAt <= publishedAt ||
    expiresAt <= Date.now()
  ) {
    return undefined;
  }

  return {
    actorUserIdSnapshot: input.actorUserIdSnapshot,
    artifactInternalId: input.artifactInternalId,
    artifactKind: input.artifactKind,
    expiresAt: input.expiresAt,
    groupId: input.groupId,
    handleHash: input.handleHash,
    membershipVersion: input.membershipVersion,
    operationId: input.operationId,
    ownerUserIdSnapshot: input.ownerUserIdSnapshot,
    publishedAt: input.publishedAt,
    version: 1,
  };
};

export class HostedGroupArtifactAccessModel {
  constructor(private readonly db: LobeChatDatabase) {}

  /** First exact marker wins; the opaque handle itself never reaches this model. */
  async record(input: HostedGroupArtifactAccessMarker): Promise<boolean> {
    const marker = normalizeMarker(input);
    if (!marker) return false;

    const serialized = JSON.stringify(marker);
    const existing = sql`coalesce(
      ${agentOperations.metadata}->'hostedGroupArtifactAccess',
      '[]'::jsonb
    )`;
    const hostedRunIdentity = {
      actorUserIdSnapshot: marker.actorUserIdSnapshot,
      groupId: marker.groupId,
      membershipVersion: marker.membershipVersion,
      ownerUserIdSnapshot: marker.ownerUserIdSnapshot,
      version: 1,
    };
    const hostedFinalIdentity = {
      actorUserIdSnapshot: marker.actorUserIdSnapshot,
      groupId: marker.groupId,
      membershipVersion: marker.membershipVersion,
      operationId: marker.operationId,
      ownerUserIdSnapshot: marker.ownerUserIdSnapshot,
      publishedAt: marker.publishedAt,
      version: 1,
    };
    const [row] = await this.db
      .update(agentOperations)
      .set({
        metadata: sql`case
          when ${existing} @> jsonb_build_array(${serialized}::jsonb)
          then ${agentOperations.metadata}
          else jsonb_set(
            coalesce(${agentOperations.metadata}, '{}'::jsonb),
            '{hostedGroupArtifactAccess}',
            ${existing} || jsonb_build_array(${serialized}::jsonb),
            true
          )
        end`,
      })
      .where(
        and(
          eq(agentOperations.id, marker.operationId),
          eq(agentOperations.userId, marker.ownerUserIdSnapshot),
          eq(agentOperations.chatGroupId, marker.groupId),
          eq(agentOperations.status, 'done'),
          isNull(agentOperations.workspaceId),
          sql`${agentOperations.metadata} @> ${JSON.stringify({ hostedGroupRun: hostedRunIdentity })}::jsonb`,
          sql`${agentOperations.metadata} @> ${JSON.stringify({ hostedGroupMemberFinal: hostedFinalIdentity })}::jsonb`,
          sql`(
            ${agentOperations.metadata}->'hostedGroupArtifactAccess' is null
            or jsonb_typeof(${agentOperations.metadata}->'hostedGroupArtifactAccess') = 'array'
          )`,
          sql`(
            not (${existing} @> jsonb_build_array(
              jsonb_build_object('handleHash', ${marker.handleHash}::text)
            ))
            or ${existing} @> jsonb_build_array(${serialized}::jsonb)
          )`,
        ),
      )
      .returning({ id: agentOperations.id });

    return Boolean(row);
  }

  /**
   * One query rechecks the current reader, group owner and personal workspace.
   * The service performs the final exact marker parsing before projecting data.
   */
  async findAuthorizedCandidate(input: {
    groupId: string;
    handleHash: string;
    readerUserId: string;
  }): Promise<HostedGroupArtifactAccessCandidate | null> {
    if (
      !canonicalText(input.groupId, 255) ||
      !canonicalText(input.readerUserId, 255) ||
      !/^[a-f\d]{64}$/.test(input.handleHash)
    ) {
      return null;
    }

    const rows = await this.db
      .select({
        metadata: agentOperations.metadata,
        operationGroupId: agentOperations.chatGroupId,
        operationId: agentOperations.id,
        operationOwnerUserId: agentOperations.userId,
        readerJoinedAt: chatGroupUserMemberships.joinedAt,
        readerMembershipVersion: chatGroupUserMemberships.membershipVersion,
      })
      .from(agentOperations)
      .innerJoin(
        chatGroups,
        and(
          eq(chatGroups.id, agentOperations.chatGroupId),
          eq(chatGroups.userId, agentOperations.userId),
          isNull(chatGroups.workspaceId),
        ),
      )
      .innerJoin(
        chatGroupUserMemberships,
        and(
          eq(chatGroupUserMemberships.chatGroupId, chatGroups.id),
          eq(chatGroupUserMemberships.userId, input.readerUserId),
          isNull(chatGroupUserMemberships.removedAt),
        ),
      )
      .where(
        and(
          eq(agentOperations.chatGroupId, input.groupId),
          eq(agentOperations.status, 'done'),
          isNull(agentOperations.workspaceId),
          sql`${agentOperations.metadata} @> ${JSON.stringify({ hostedGroupArtifactAccess: [{ handleHash: input.handleHash }] })}::jsonb`,
        ),
      )
      .limit(2);
    if (rows.length !== 1) return null;

    const row = rows[0];
    const metadata = row.metadata as { hostedGroupArtifactAccess?: unknown } | null;
    if (!Array.isArray(metadata?.hostedGroupArtifactAccess)) return null;
    const markers = metadata.hostedGroupArtifactAccess.filter(
      (value): value is Record<string, unknown> =>
        Boolean(value) &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).handleHash === input.handleHash,
    );
    if (markers.length !== 1) return null;
    const markerPublishedAt =
      typeof markers[0].publishedAt === 'string'
        ? canonicalTimestamp(markers[0].publishedAt)
        : undefined;
    if (markerPublishedAt === undefined || row.readerJoinedAt.getTime() > markerPublishedAt)
      return null;

    return {
      marker: markers[0],
      operationGroupId: row.operationGroupId,
      operationId: row.operationId,
      operationOwnerUserId: row.operationOwnerUserId,
      readerJoinedAt: row.readerJoinedAt,
      readerMembershipVersion: row.readerMembershipVersion,
    };
  }
}
