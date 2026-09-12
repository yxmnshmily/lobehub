import { createHash, randomBytes } from 'node:crypto';

import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { agentOperations, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { resolveHostedTravelGroupTarget as ResolveHostedTravelGroupTarget } from './groupChat';

const HOSTED_RUN_TTL_MS = 24 * 60 * 60_000;
const SNAPSHOT_VERSION = 1;

export interface HostedGroupRunSnapshot {
  actorUserIdSnapshot: string;
  expiresAt: string;
  groupId: string;
  handleHash: string;
  membershipVersion: number;
  ownerUserIdSnapshot: string;
  version: 1;
}

export interface HostedGroupRunAccess {
  completedAt: Date | null;
  error: unknown;
  operationId: string;
  resultTopicId?: string;
  startedAt: Date | null;
  status: string;
  updatedAt: Date;
}

const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' });

/** Project only the topic created by this run inside its authorized conversation scope. */
export const resolveHostedGroupResultTopicId = async (
  db: LobeChatDatabase,
  input: { groupId: string; ownerUserId: string; topicId?: string | null },
) => {
  if (!input.topicId) return;
  const topic = await db.query.topics.findFirst({
    columns: { id: true },
    where: and(
      eq(topics.id, input.topicId),
      eq(topics.groupId, input.groupId),
      eq(topics.userId, input.ownerUserId),
      isNull(topics.workspaceId),
      isNull(topics.deletedAt),
    ),
  });
  return topic?.id;
};

export const hashHostedGroupRunHandle = (runHandle: string) =>
  createHash('sha256').update('hosted-group-run:v1\0').update(runHandle).digest('hex');

export const createHostedGroupRunBinding = (input: {
  actorUserId: string;
  groupId: string;
  membershipVersion: number;
  now?: Date;
  ownerUserId: string;
}) => {
  const runHandle = randomBytes(32).toString('base64url');
  const now = input.now ?? new Date();
  const snapshot: HostedGroupRunSnapshot = {
    actorUserIdSnapshot: input.actorUserId,
    expiresAt: new Date(now.getTime() + HOSTED_RUN_TTL_MS).toISOString(),
    groupId: input.groupId,
    handleHash: hashHostedGroupRunHandle(runHandle),
    membershipVersion: input.membershipVersion,
    ownerUserIdSnapshot: input.ownerUserId,
    version: SNAPSHOT_VERSION,
  };
  return { runHandle, snapshot };
};

export const parseHostedGroupRunSnapshot = (value: unknown): HostedGroupRunSnapshot | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const snapshot = value as Partial<HostedGroupRunSnapshot>;
  if (
    snapshot.version !== SNAPSHOT_VERSION ||
    typeof snapshot.actorUserIdSnapshot !== 'string' ||
    !snapshot.actorUserIdSnapshot.trim() ||
    typeof snapshot.ownerUserIdSnapshot !== 'string' ||
    !snapshot.ownerUserIdSnapshot.trim() ||
    snapshot.actorUserIdSnapshot === snapshot.ownerUserIdSnapshot ||
    typeof snapshot.groupId !== 'string' ||
    !snapshot.groupId.trim() ||
    typeof snapshot.handleHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.handleHash) ||
    !Number.isSafeInteger(snapshot.membershipVersion) ||
    Number(snapshot.membershipVersion) <= 0 ||
    typeof snapshot.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(snapshot.expiresAt))
  ) {
    return undefined;
  }
  return snapshot as HostedGroupRunSnapshot;
};

export const authorizeHostedGroupRun = async (input: {
  db: LobeChatDatabase;
  groupId: string;
  runHandle: string;
  userId: string;
}): Promise<HostedGroupRunAccess> => {
  const handleHash = hashHostedGroupRunHandle(input.runHandle);
  let target: Awaited<ReturnType<typeof ResolveHostedTravelGroupTarget>>;
  try {
    const { resolveHostedTravelGroupTarget } = await import('./groupChat');
    target = await resolveHostedTravelGroupTarget({
      db: input.db,
      groupId: input.groupId,
      userId: input.userId,
      workspaceId: null,
    });
  } catch {
    throw notFound();
  }
  if (
    !target ||
    target.principal.kind !== 'owner-sponsored-member' ||
    target.principal.actorUserId !== input.userId ||
    target.groupId !== input.groupId
  ) {
    throw notFound();
  }

  const expectedSnapshot = {
    actorUserIdSnapshot: target.principal.actorUserId,
    groupId: target.groupId,
    handleHash,
    membershipVersion: target.principal.membershipVersion,
    ownerUserIdSnapshot: target.principal.resourceOwnerUserId,
    version: SNAPSHOT_VERSION,
  };
  const rows = await input.db
    .select({
      chatGroupId: agentOperations.chatGroupId,
      completedAt: agentOperations.completedAt,
      error: agentOperations.error,
      id: agentOperations.id,
      metadata: agentOperations.metadata,
      startedAt: agentOperations.startedAt,
      status: agentOperations.status,
      topicId: agentOperations.topicId,
      updatedAt: agentOperations.updatedAt,
      userId: agentOperations.userId,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(
      and(
        eq(agentOperations.chatGroupId, input.groupId),
        eq(agentOperations.userId, target.principal.resourceOwnerUserId),
        isNull(agentOperations.workspaceId),
        sql`${agentOperations.metadata} @> ${JSON.stringify({ hostedGroupRun: expectedSnapshot })}::jsonb`,
      ),
    )
    .limit(2);
  if (rows.length !== 1) throw notFound();

  const operation = rows[0];
  const metadata = operation.metadata as { hostedGroupRun?: unknown } | null;
  const snapshot = parseHostedGroupRunSnapshot(metadata?.hostedGroupRun);
  if (
    !snapshot ||
    snapshot.handleHash !== handleHash ||
    snapshot.actorUserIdSnapshot !== input.userId ||
    snapshot.ownerUserIdSnapshot !== operation.userId ||
    snapshot.groupId !== input.groupId ||
    operation.chatGroupId !== input.groupId ||
    operation.workspaceId !== null ||
    Date.parse(snapshot.expiresAt) <= Date.now()
  ) {
    throw notFound();
  }

  if (
    target.principal.actorUserId !== snapshot.actorUserIdSnapshot ||
    target.principal.resourceOwnerUserId !== snapshot.ownerUserIdSnapshot ||
    target.principal.membershipVersion !== snapshot.membershipVersion ||
    target.groupId !== snapshot.groupId
  ) {
    throw notFound();
  }

  return {
    completedAt: operation.completedAt,
    error: operation.error,
    operationId: operation.id,
    resultTopicId: await resolveHostedGroupResultTopicId(input.db, {
      groupId: input.groupId,
      ownerUserId: operation.userId,
      topicId: operation.topicId,
    }),
    startedAt: operation.startedAt,
    status: operation.status,
    updatedAt: operation.updatedAt,
  };
};

const toISOString = (value: Date | null) => value?.toISOString() ?? null;

export const projectHostedGroupRunStatus = (access: HostedGroupRunAccess) => ({
  completedAt: toISOString(access.completedAt),
  errorSummary: access.error ? '任务执行失败，请稍后重试。' : null,
  ...(access.resultTopicId ? { resultTopicId: access.resultTopicId } : {}),
  startedAt: toISOString(access.startedAt),
  status: access.status,
  updatedAt: access.updatedAt.toISOString(),
});
