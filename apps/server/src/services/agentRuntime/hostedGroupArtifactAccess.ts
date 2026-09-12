import { createHash, randomBytes } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';

import {
  type HostedGroupArtifactAccessMarker,
  HostedGroupArtifactAccessModel,
  type HostedGroupArtifactKind,
} from '@/database/models/hostedGroupArtifactAccess';

const HANDLE_TTL_MS = 24 * 60 * 60_000;
const HANDLE_PATTERN = /^[\w-]{43}$/;
const HASH_PATTERN = /^[a-f\d]{64}$/;

export const HOSTED_GROUP_ARTIFACT_NOT_FOUND = 'HOSTED_GROUP_ARTIFACT_NOT_FOUND' as const;

export class HostedGroupArtifactNotFoundError extends Error {
  readonly code = HOSTED_GROUP_ARTIFACT_NOT_FOUND;

  constructor() {
    super(HOSTED_GROUP_ARTIFACT_NOT_FOUND);
    this.name = 'HostedGroupArtifactNotFoundError';
  }
}

export interface HostedGroupArtifactSafeProjection {
  artifactKind: HostedGroupArtifactKind;
  publishedAt: string;
}

const CREATE_KEYS = [
  'actorUserId',
  'artifactInternalId',
  'artifactKind',
  'groupId',
  'membershipVersion',
  'operationId',
  'ownerUserId',
  'publishedAt',
] as const;
const MARKER_KEYS = [
  'actorUserIdSnapshot',
  'artifactInternalId',
  'artifactKind',
  'expiresAt',
  'groupId',
  'handleHash',
  'membershipVersion',
  'operationId',
  'ownerUserIdSnapshot',
  'publishedAt',
  'version',
] as const;
const RESOLVE_KEYS = ['groupId', 'handle', 'readerUserId'] as const;
const CANDIDATE_KEYS = [
  'marker',
  'operationGroupId',
  'operationId',
  'operationOwnerUserId',
  'readerJoinedAt',
  'readerMembershipVersion',
] as const;

const notFound = () => new HostedGroupArtifactNotFoundError();

const isExactRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value as object).length === keys.length &&
  Object.keys(value as object).every((key) => keys.includes(key));

const canonicalText = (value: unknown, maxLength = 512): value is string =>
  typeof value === 'string' &&
  Boolean(value) &&
  value.trim() === value &&
  value.length <= maxLength;

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const canonicalTimestamp = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : undefined;
};

const parseCreateInput = (
  value: unknown,
  now: Date,
):
  | {
      actorUserId: string;
      artifactInternalId: string;
      artifactKind: HostedGroupArtifactKind;
      groupId: string;
      membershipVersion: number;
      operationId: string;
      ownerUserId: string;
      publishedAt: string;
    }
  | undefined => {
  if (!isExactRecord(value, CREATE_KEYS)) return undefined;
  const publishedAt = canonicalTimestamp(value.publishedAt);
  if (
    !canonicalText(value.actorUserId, 255) ||
    !canonicalText(value.ownerUserId, 255) ||
    value.actorUserId === value.ownerUserId ||
    !canonicalText(value.groupId, 255) ||
    !canonicalText(value.operationId, 255) ||
    !canonicalText(value.artifactInternalId) ||
    (value.artifactKind !== 'text' && value.artifactKind !== 'document') ||
    !positiveSafeInteger(value.membershipVersion) ||
    publishedAt === undefined ||
    publishedAt > now.getTime()
  ) {
    return undefined;
  }
  return {
    actorUserId: value.actorUserId,
    artifactInternalId: value.artifactInternalId,
    artifactKind: value.artifactKind,
    groupId: value.groupId,
    membershipVersion: value.membershipVersion,
    operationId: value.operationId,
    ownerUserId: value.ownerUserId,
    publishedAt: value.publishedAt as string,
  };
};

const parseMarker = (value: unknown, now: Date): HostedGroupArtifactAccessMarker | undefined => {
  if (!isExactRecord(value, MARKER_KEYS)) return undefined;
  const publishedAt = canonicalTimestamp(value.publishedAt);
  const expiresAt = canonicalTimestamp(value.expiresAt);
  if (
    value.version !== 1 ||
    !canonicalText(value.actorUserIdSnapshot, 255) ||
    !canonicalText(value.ownerUserIdSnapshot, 255) ||
    value.actorUserIdSnapshot === value.ownerUserIdSnapshot ||
    !canonicalText(value.groupId, 255) ||
    !canonicalText(value.operationId, 255) ||
    !canonicalText(value.artifactInternalId) ||
    (value.artifactKind !== 'text' && value.artifactKind !== 'document') ||
    typeof value.handleHash !== 'string' ||
    !HASH_PATTERN.test(value.handleHash) ||
    !positiveSafeInteger(value.membershipVersion) ||
    publishedAt === undefined ||
    expiresAt === undefined ||
    publishedAt > now.getTime() ||
    expiresAt <= publishedAt ||
    expiresAt <= now.getTime()
  ) {
    return undefined;
  }
  return {
    actorUserIdSnapshot: value.actorUserIdSnapshot,
    artifactInternalId: value.artifactInternalId,
    artifactKind: value.artifactKind,
    expiresAt: value.expiresAt as string,
    groupId: value.groupId,
    handleHash: value.handleHash as string,
    membershipVersion: value.membershipVersion,
    operationId: value.operationId,
    ownerUserIdSnapshot: value.ownerUserIdSnapshot,
    publishedAt: value.publishedAt as string,
    version: 1,
  };
};

const hashHandle = (handle: string) =>
  createHash('sha256').update('hosted-group-artifact:v1\0').update(handle).digest('hex');

const project = (marker: HostedGroupArtifactAccessMarker): HostedGroupArtifactSafeProjection => ({
  artifactKind: marker.artifactKind,
  publishedAt: marker.publishedAt,
});

export const createHostedGroupArtifactHandle = async (
  db: LobeChatDatabase,
  input: unknown,
  now = new Date(),
): Promise<{ artifact: HostedGroupArtifactSafeProjection; handle: string }> => {
  if (!Number.isFinite(now.getTime())) throw notFound();
  const parsed = parseCreateInput(input, now);
  if (!parsed) throw notFound();

  const handle = randomBytes(32).toString('base64url');
  const marker: HostedGroupArtifactAccessMarker = {
    actorUserIdSnapshot: parsed.actorUserId,
    artifactInternalId: parsed.artifactInternalId,
    artifactKind: parsed.artifactKind,
    expiresAt: new Date(now.getTime() + HANDLE_TTL_MS).toISOString(),
    groupId: parsed.groupId,
    handleHash: hashHandle(handle),
    membershipVersion: parsed.membershipVersion,
    operationId: parsed.operationId,
    ownerUserIdSnapshot: parsed.ownerUserId,
    publishedAt: parsed.publishedAt,
    version: 1,
  };
  try {
    if (!(await new HostedGroupArtifactAccessModel(db).record(marker))) throw notFound();
  } catch {
    throw notFound();
  }
  return { artifact: project(marker), handle };
};

export const resolveHostedGroupArtifact = async (
  db: LobeChatDatabase,
  input: unknown,
  now = new Date(),
): Promise<HostedGroupArtifactSafeProjection> => {
  if (!Number.isFinite(now.getTime()) || !isExactRecord(input, RESOLVE_KEYS)) throw notFound();
  if (
    !canonicalText(input.groupId, 255) ||
    !canonicalText(input.readerUserId, 255) ||
    typeof input.handle !== 'string' ||
    !HANDLE_PATTERN.test(input.handle)
  ) {
    throw notFound();
  }

  const handleHash = hashHandle(input.handle);
  let candidate;
  try {
    candidate = await new HostedGroupArtifactAccessModel(db).findAuthorizedCandidate({
      groupId: input.groupId,
      handleHash,
      readerUserId: input.readerUserId,
    });
  } catch {
    throw notFound();
  }
  if (!candidate) throw notFound();

  if (
    !isExactRecord(candidate, CANDIDATE_KEYS) ||
    !canonicalText(candidate.operationId, 255) ||
    !canonicalText(candidate.operationOwnerUserId, 255) ||
    !canonicalText(candidate.operationGroupId, 255) ||
    !(candidate.readerJoinedAt instanceof Date) ||
    !Number.isFinite(candidate.readerJoinedAt.getTime()) ||
    !positiveSafeInteger(candidate.readerMembershipVersion)
  ) {
    throw notFound();
  }
  const marker = parseMarker(candidate.marker, now);
  if (
    !marker ||
    marker.handleHash !== handleHash ||
    marker.groupId !== input.groupId ||
    marker.operationId !== candidate.operationId ||
    marker.groupId !== candidate.operationGroupId ||
    marker.ownerUserIdSnapshot !== candidate.operationOwnerUserId ||
    candidate.readerJoinedAt.getTime() > Date.parse(marker.publishedAt)
  ) {
    throw notFound();
  }

  return project(marker);
};
