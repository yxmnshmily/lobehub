import type { LobeChatDatabase } from '@lobechat/database';
import { and, eq, isNull } from 'drizzle-orm';

import { platformCreditEntries } from '@/database/schemas/platformCredit';

import { isSafeArtifactIdentifier } from './artifactSafety';
import { buildPlatformImageSettlementIdentity } from './platformImageSettlementIdentity';

interface SettledTravelImageUsageInput {
  asyncTaskId: string;
  db: LobeChatDatabase;
  generationId: string;
  userId: string;
  workspaceId?: string;
}

/** Verifies the durable usage charge written by the platform-managed image worker. */
export const hasSettledTravelImageUsage = async ({
  asyncTaskId,
  db,
  generationId,
  userId,
  workspaceId,
}: SettledTravelImageUsageInput): Promise<boolean> => {
  if (
    !isSafeArtifactIdentifier(asyncTaskId) ||
    !isSafeArtifactIdentifier(generationId) ||
    (workspaceId !== undefined && !isSafeArtifactIdentifier(workspaceId))
  ) {
    return false;
  }

  const settlementIdentity = buildPlatformImageSettlementIdentity(generationId);
  const [entry] = await db
    .select({ id: platformCreditEntries.id })
    .from(platformCreditEntries)
    .where(
      and(
        eq(platformCreditEntries.type, 'usage_charge'),
        eq(platformCreditEntries.generationType, settlementIdentity.generationType),
        eq(platformCreditEntries.generationId, settlementIdentity.generationId),
        eq(platformCreditEntries.userIdSnapshot, userId),
        eq(platformCreditEntries.actorUserIdSnapshot, userId),
        workspaceId
          ? eq(platformCreditEntries.workspaceId, workspaceId)
          : isNull(platformCreditEntries.workspaceId),
      ),
    )
    .limit(1);

  return Boolean(entry);
};
