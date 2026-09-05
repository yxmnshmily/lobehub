import { createHash } from 'node:crypto';

import type { TravelGenerationOwner, TravelGenerationType } from './index';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

const requestHash = (
  type: TravelGenerationType,
  input: Record<string, unknown>,
  maxCredits?: number,
) => sha256(JSON.stringify(canonicalize({ input, maxCredits, type })));

export const deriveTravelToolIdempotency = (params: {
  input: Record<string, unknown>;
  operationId: string;
  toolCallId: string;
  type: TravelGenerationType;
}) => ({
  key: `tg:v1:${sha256(JSON.stringify([params.operationId, params.toolCallId, params.type]))}`,
  requestHash: requestHash(params.type, params.input),
});

export const deriveTravelOrderIdempotency = (params: {
  input: Record<string, unknown>;
  maxCredits?: number;
  orderId: string;
  owner: TravelGenerationOwner;
  type: TravelGenerationType;
}) => ({
  key: `tg-order:v1:${sha256(
    JSON.stringify([
      1,
      params.orderId,
      params.owner.userId,
      params.owner.workspaceId ?? '',
      params.owner.groupId,
      params.type,
    ]),
  )}`,
  requestHash: requestHash(params.type, params.input, params.maxCredits),
});
