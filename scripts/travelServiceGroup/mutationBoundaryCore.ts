export interface TravelMutationSourceBundle {
  agentGroupRouter: string;
  agentRouter: string;
  platformAdminGuard: string;
}

export interface TravelMutationBoundaryEntry {
  action:
    | 'delete-default-group'
    | 'delete-required-agent'
    | 'disable-or-replace-member'
    | 'publish-default-group'
    | 'remove-required-member'
    | 'update-platform-managed-agent';
  adminOwnerCanMutateDefaultResource: boolean;
  currentGuard: string;
  defaultResourceGuardPresent: boolean;
  file: string;
  method: string;
  ordinaryUserCanMutate: boolean;
  recommendedModificationScope: string;
}

interface MutationSpec {
  action: TravelMutationBoundaryEntry['action'];
  expectedCall: string;
  file: TravelMutationBoundaryEntry['file'];
  guardDescription: string;
  method: string;
  procedure: 'agentGroupProcedureWrite' | 'agentWriteProcedure';
  recommendedModificationScope: string;
  source: keyof Pick<TravelMutationSourceBundle, 'agentGroupRouter' | 'agentRouter'>;
}

const MUTATION_SPECS: MutationSpec[] = [
  {
    action: 'delete-default-group',
    expectedCall: 'ctx.agentGroupService.deleteGroup(input.id)',
    file: 'apps/server/src/routers/lambda/agentGroup.ts',
    guardDescription:
      'workspace delete ACL and foreign-row owner rule; personal scope falls back to row ownership',
    method: 'deleteGroup',
    procedure: 'agentGroupProcedureWrite',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agentGroup.ts',
    source: 'agentGroupRouter',
  },
  {
    action: 'publish-default-group',
    expectedCall: 'ctx.chatGroupModel.publishToWorkspace(input.id)',
    file: 'apps/server/src/routers/lambda/agentGroup.ts',
    guardDescription:
      'creator-owned still-private SQL update; workspace publish also rejects private members',
    method: 'publishGroupToWorkspace',
    procedure: 'agentGroupProcedureWrite',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agentGroup.ts',
    source: 'agentGroupRouter',
  },
  {
    action: 'publish-default-group',
    expectedCall: 'ctx.chatGroupModel.setVisibility(input.id, input.visibility)',
    file: 'apps/server/src/routers/lambda/agentGroup.ts',
    guardDescription: 'workspace-only changeVisibility ACL and private-member compatibility check',
    method: 'setGroupVisibility',
    procedure: 'agentGroupProcedureWrite',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agentGroup.ts',
    source: 'agentGroupRouter',
  },
  {
    action: 'disable-or-replace-member',
    expectedCall: 'ctx.chatGroupModel.updateAgentInGroup',
    file: 'apps/server/src/routers/lambda/agentGroup.ts',
    guardDescription:
      'workspace edit ACL; closed role enum; only group-owned agents may be promoted to supervisor',
    method: 'updateAgentInGroup',
    procedure: 'agentGroupProcedureWrite',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agentGroup.ts',
    source: 'agentGroupRouter',
  },
  {
    action: 'remove-required-member',
    expectedCall: 'ctx.agentGroupRepo.removeAgentsFromGroup',
    file: 'apps/server/src/routers/lambda/agentGroup.ts',
    guardDescription: 'workspace edit ACL plus ownership-scoped repository removal',
    method: 'removeAgentsFromGroup',
    procedure: 'agentGroupProcedureWrite',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agentGroup.ts',
    source: 'agentGroupRouter',
  },
  {
    action: 'delete-required-agent',
    expectedCall: 'ctx.agentModel.delete(input.agentId)',
    file: 'apps/server/src/routers/lambda/agent.ts',
    guardDescription: 'agent:delete permission, workspace delete ACL, and ownership-scoped delete',
    method: 'removeAgent',
    procedure: 'agentWriteProcedure',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agent.ts',
    source: 'agentRouter',
  },
  {
    action: 'update-platform-managed-agent',
    expectedCall: 'ctx.agentService.updateAgentConfig(input.agentId, safeValue)',
    file: 'apps/server/src/routers/lambda/agent.ts',
    guardDescription:
      'agent:update permission and edit ACL; modelRuntimeMode is sanitized but model/provider are mutable',
    method: 'updateAgentConfig',
    procedure: 'agentWriteProcedure',
    recommendedModificationScope: 'apps/server/src/routers/lambda/agent.ts',
    source: 'agentRouter',
  },
];

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractConstInitializer = (source: string, name: string) => {
  const match = source.match(new RegExp(`const\\s+${escapeRegExp(name)}\\s*=([\\s\\S]*?);`));
  return match?.[1] ?? '';
};

const extractRouterMethod = (source: string, method: string) => {
  const start = source.search(new RegExp(`^  ${escapeRegExp(method)}:`, 'm'));
  if (start < 0) return '';

  const rest = source.slice(start + 1);
  const next = rest.search(/^\s{2}[a-z][a-z0-9]+:/im);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
};

const hasDefaultResourceGuard = (methodSource: string) =>
  /DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID|isDefaultTravelServiceGroupClientId|isRequiredTravelServiceAgentIdentity/.test(
    methodSource,
  );

export const auditTravelMutationBoundaries = (
  sources: TravelMutationSourceBundle,
): TravelMutationBoundaryEntry[] => {
  const platformGuardFailsClosed =
    sources.platformAdminGuard.includes("hasGlobalRole('super_admin')") &&
    sources.platformAdminGuard.includes("code: 'FORBIDDEN'") &&
    sources.platformAdminGuard.includes('account.banned === true');
  const guardedProcedures = new Map(
    ['agentGroupProcedureWrite', 'agentWriteProcedure'].map((procedure) => [
      procedure,
      platformGuardFailsClosed &&
        extractConstInitializer(
          procedure === 'agentGroupProcedureWrite' ? sources.agentGroupRouter : sources.agentRouter,
          procedure,
        ).includes('.use(requirePlatformAdmin)'),
    ]),
  );

  return MUTATION_SPECS.map((spec) => {
    const methodSource = extractRouterMethod(sources[spec.source], spec.method);
    const usesExpectedProcedure = new RegExp(
      `^  ${escapeRegExp(spec.method)}:\\s*${escapeRegExp(spec.procedure)}\\b`,
      'm',
    ).test(methodSource);
    const reachesExpectedMutation = methodSource.includes(spec.expectedCall);
    const adminGuarded =
      platformGuardFailsClosed &&
      guardedProcedures.get(spec.procedure) === true &&
      usesExpectedProcedure &&
      reachesExpectedMutation;
    // The managed default group is provisioned in the user's personal scope.
    // setGroupVisibility refuses every non-workspace call before touching the model;
    // publishGroupToWorkspace is the actual personal-scope promotion path.
    const reachesPersonalDefaultResource = spec.method !== 'setGroupVisibility';

    return {
      action: spec.action,
      adminOwnerCanMutateDefaultResource:
        adminGuarded && reachesPersonalDefaultResource && !hasDefaultResourceGuard(methodSource),
      currentGuard: adminGuarded
        ? `${spec.procedure} -> requirePlatformAdmin(active super_admin); ${spec.guardDescription}`
        : 'EXPECTED ADMIN GUARD NOT VERIFIED',
      defaultResourceGuardPresent: hasDefaultResourceGuard(methodSource),
      file: spec.file,
      method: spec.method,
      ordinaryUserCanMutate: !adminGuarded,
      recommendedModificationScope: spec.recommendedModificationScope,
    };
  });
};

export const summarizeTravelMutationBoundaries = (entries: TravelMutationBoundaryEntry[]) => ({
  adminMutableWithoutDefaultGuardCount: entries.filter(
    ({ adminOwnerCanMutateDefaultResource }) => adminOwnerCanMutateDefaultResource,
  ).length,
  entries,
  ordinaryUserMutableCount: entries.filter(({ ordinaryUserCanMutate }) => ordinaryUserCanMutate)
    .length,
});
