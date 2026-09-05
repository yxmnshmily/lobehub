export interface TravelGroupAuditInput {
  checks: Array<{
    groupVisibility: 'private' | 'public' | null;
    ready: boolean;
  }>;
  crossUserBindingCount: number;
  defaultGroupCounts: number[];
  disabledDefaultMemberCount: number;
}

export interface TravelGroupIntegrityInspection {
  crossUserBindingCount: number;
  defaultGroupCount: number;
  groupVisibility: 'private' | 'public' | null;
  missingOrDisabledRequiredMemberCount: number;
  platformManagedIdentityAbnormal: boolean;
  supervisorCount: number;
  supervisorTitle: string | null;
}

export const hasPlatformManagedIdentityAnomaly = ({
  missingFixedModelSelectionClientIds,
  missingPlatformManagedRuntimeClientIds,
  missingSpecialistClientIds,
  supervisorCount,
  supervisorModelRuntimeMode,
  supervisorModelSelectionPolicy,
}: {
  missingFixedModelSelectionClientIds: string[];
  missingPlatformManagedRuntimeClientIds: string[];
  missingSpecialistClientIds: string[];
  supervisorCount: number;
  supervisorModelRuntimeMode: string | null;
  supervisorModelSelectionPolicy: string | null;
}) => {
  const missingSpecialists = new Set(missingSpecialistClientIds);
  const malformedExistingSpecialist = [
    ...missingPlatformManagedRuntimeClientIds,
    ...missingFixedModelSelectionClientIds,
  ].some((clientId) => !missingSpecialists.has(clientId));
  const malformedSupervisor =
    supervisorCount === 1 &&
    (supervisorModelRuntimeMode !== 'platform-managed' ||
      supervisorModelSelectionPolicy !== 'fixed');

  return malformedExistingSpecialist || malformedSupervisor;
};

export const parseTravelGroupAuditArgs = (argv: string[]) => {
  const unknown = argv.find((arg) => arg !== '--repair');
  if (unknown) throw new Error(`Unknown travel group audit argument: ${unknown}`);
  return { repair: argv.includes('--repair') };
};

export const safeAuditFailureMessage = (_error: unknown) => 'Travel service group audit failed';

interface ScopedTravelGroupInspection {
  check: TravelGroupAuditInput['checks'][number];
  crossUserBindingCount: number;
  defaultGroupCount: number;
  disabledDefaultMemberCount: number;
}

export const summarizeTravelGroupAudit = ({
  checks,
  crossUserBindingCount,
  defaultGroupCounts,
  disabledDefaultMemberCount,
}: TravelGroupAuditInput) => ({
  crossUserBindingCount,
  defaultGroupCount: defaultGroupCounts.reduce((sum, count) => sum + count, 0),
  disabledDefaultMemberCount,
  duplicateGroupUserCount: defaultGroupCounts.filter((count) => count > 1).length,
  missingGroupUserCount: defaultGroupCounts.filter((count) => count === 0).length,
  nonPrivateGroupUserCount: checks.filter(
    ({ groupVisibility }) => groupVisibility !== null && groupVisibility !== 'private',
  ).length,
  readyUserCount: checks.filter(({ ready }) => ready).length,
  userCount: checks.length,
});

export const summarizeTravelGroupIntegrityAudit = (
  inspections: TravelGroupIntegrityInspection[],
) => ({
  crossUserBindingCount: inspections.reduce(
    (sum, inspection) => sum + inspection.crossUserBindingCount,
    0,
  ),
  duplicateDefaultGroupUserCount: inspections.filter(
    ({ defaultGroupCount }) => defaultGroupCount > 1,
  ).length,
  invalidSupervisorCountUserCount: inspections.filter(
    ({ supervisorCount }) => supervisorCount !== 1,
  ).length,
  missingDefaultGroupUserCount: inspections.filter(
    ({ defaultGroupCount }) => defaultGroupCount === 0,
  ).length,
  missingOrDisabledRequiredMemberUserCount: inspections.filter(
    ({ missingOrDisabledRequiredMemberCount }) => missingOrDisabledRequiredMemberCount > 0,
  ).length,
  nonPrivateDefaultGroupUserCount: inspections.filter(
    ({ groupVisibility }) => groupVisibility !== null && groupVisibility !== 'private',
  ).length,
  platformManagedIdentityAbnormalUserCount: inspections.filter(
    ({ platformManagedIdentityAbnormal }) => platformManagedIdentityAbnormal,
  ).length,
  supervisorTitleMismatchUserCount: inspections.filter(
    ({ supervisorCount, supervisorTitle }) =>
      supervisorCount === 1 && supervisorTitle !== '旅游群主AI',
  ).length,
  verifiedUnbannedUserCount: inspections.length,
});

export const runTravelGroupIntegrityAudit = async ({
  inspect,
  listEligibleUserIds,
}: {
  inspect: (userId: string) => Promise<TravelGroupIntegrityInspection>;
  listEligibleUserIds: () => Promise<string[]>;
}) => {
  const userIds = await listEligibleUserIds();
  const inspections: TravelGroupIntegrityInspection[] = [];
  for (const userId of userIds) inspections.push(await inspect(userId));
  return summarizeTravelGroupIntegrityAudit(inspections);
};

export const runScopedTravelGroupAudit = async (
  userId: string,
  inspect: (userId: string) => Promise<ScopedTravelGroupInspection>,
) => {
  const inspection = await inspect(userId);
  return summarizeTravelGroupAudit({
    checks: [inspection.check],
    crossUserBindingCount: inspection.crossUserBindingCount,
    defaultGroupCounts: [inspection.defaultGroupCount],
    disabledDefaultMemberCount: inspection.disabledDefaultMemberCount,
  });
};
