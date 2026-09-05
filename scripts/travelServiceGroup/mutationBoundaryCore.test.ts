import { describe, expect, it } from 'vitest';

import {
  auditTravelMutationBoundaries,
  summarizeTravelMutationBoundaries,
  type TravelMutationSourceBundle,
} from './mutationBoundaryCore';

const guardedSources = (): TravelMutationSourceBundle => ({
  agentGroupRouter: `
const agentGroupProcedureWrite = agentGroupProcedure
  .use(requirePlatformAdmin)
  .use(withScopedPermission('agent:update'));
export const router = {
  deleteGroup: agentGroupProcedureWrite.mutation(() => ctx.agentGroupService.deleteGroup(input.id)),
  publishGroupToWorkspace: agentGroupProcedureWrite.mutation(() => ctx.chatGroupModel.publishToWorkspace(input.id)),
  setGroupVisibility: agentGroupProcedureWrite.mutation(() => ctx.chatGroupModel.setVisibility(input.id, input.visibility)),
  updateAgentInGroup: agentGroupProcedureWrite.mutation(() => ctx.chatGroupModel.updateAgentInGroup()),
  removeAgentsFromGroup: agentGroupProcedureWrite.mutation(() => ctx.agentGroupRepo.removeAgentsFromGroup()),
};`,
  agentRouter: `
const agentWriteProcedure = agentProcedure.use(requirePlatformAdmin);
export const router = {
  removeAgent: agentWriteProcedure.mutation(() => ctx.agentModel.delete(input.agentId)),
  updateAgentConfig: agentWriteProcedure.mutation(() => ctx.agentService.updateAgentConfig(input.agentId, safeValue)),
};`,
  platformAdminGuard: `
account.banned === true;
rbac.hasGlobalRole('super_admin');
throw new TRPCError({ code: 'FORBIDDEN' });`,
});

describe('auditTravelMutationBoundaries', () => {
  it('verifies all dangerous routes reject ordinary users while exposing missing default guards', () => {
    const entries = auditTravelMutationBoundaries(guardedSources());
    const summary = summarizeTravelMutationBoundaries(entries);

    expect(entries).toHaveLength(7);
    expect(summary.ordinaryUserMutableCount).toBe(0);
    expect(summary.adminMutableWithoutDefaultGuardCount).toBe(6);
    expect(
      entries
        .filter(({ method }) => method !== 'setGroupVisibility')
        .every(({ adminOwnerCanMutateDefaultResource }) => adminOwnerCanMutateDefaultResource),
    ).toBe(true);
    expect(entries.find(({ method }) => method === 'setGroupVisibility')).toMatchObject({
      adminOwnerCanMutateDefaultResource: false,
    });
    expect(entries.every(({ defaultResourceGuardPresent }) => !defaultResourceGuardPresent)).toBe(
      true,
    );
  });

  it('fails closed when a route drops the platform-admin procedure', () => {
    const sources = guardedSources();
    sources.agentGroupRouter = sources.agentGroupRouter.replace(
      'deleteGroup: agentGroupProcedureWrite',
      'deleteGroup: agentGroupProcedure',
    );

    const entry = auditTravelMutationBoundaries(sources).find(
      ({ method }) => method === 'deleteGroup',
    );

    expect(entry).toMatchObject({
      currentGuard: 'EXPECTED ADMIN GUARD NOT VERIFIED',
      ordinaryUserCanMutate: true,
    });
  });

  it('recognizes a route-local default resource guard independently of the admin guard', () => {
    const sources = guardedSources();
    sources.agentRouter = sources.agentRouter.replace(
      'removeAgent: agentWriteProcedure.mutation',
      'removeAgent: agentWriteProcedure.use(isRequiredTravelServiceAgentIdentity).mutation',
    );

    const entry = auditTravelMutationBoundaries(sources).find(
      ({ method }) => method === 'removeAgent',
    );

    expect(entry).toMatchObject({
      defaultResourceGuardPresent: true,
      ordinaryUserCanMutate: false,
    });
  });
});
