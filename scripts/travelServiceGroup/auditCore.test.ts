import { describe, expect, it, vi } from 'vitest';

import {
  hasPlatformManagedIdentityAnomaly,
  parseTravelGroupAuditArgs,
  runScopedTravelGroupAudit,
  runTravelGroupIntegrityAudit,
  safeAuditFailureMessage,
  summarizeTravelGroupAudit,
  summarizeTravelGroupIntegrityAudit,
} from './auditCore';

describe('hasPlatformManagedIdentityAnomaly', () => {
  it('does not relabel missing resources as malformed platform-managed identities', () => {
    expect(
      hasPlatformManagedIdentityAnomaly({
        missingFixedModelSelectionClientIds: ['missing-agent'],
        missingPlatformManagedRuntimeClientIds: ['missing-agent'],
        missingSpecialistClientIds: ['missing-agent'],
        supervisorCount: 0,
        supervisorModelRuntimeMode: null,
        supervisorModelSelectionPolicy: null,
      }),
    ).toBe(false);
  });

  it('detects malformed markers on existing specialists or the attached supervisor', () => {
    expect(
      hasPlatformManagedIdentityAnomaly({
        missingFixedModelSelectionClientIds: [],
        missingPlatformManagedRuntimeClientIds: ['existing-agent'],
        missingSpecialistClientIds: [],
        supervisorCount: 1,
        supervisorModelRuntimeMode: 'platform-managed',
        supervisorModelSelectionPolicy: 'fixed',
      }),
    ).toBe(true);
    expect(
      hasPlatformManagedIdentityAnomaly({
        missingFixedModelSelectionClientIds: [],
        missingPlatformManagedRuntimeClientIds: [],
        missingSpecialistClientIds: [],
        supervisorCount: 1,
        supervisorModelRuntimeMode: 'actor',
        supervisorModelSelectionPolicy: 'fixed',
      }),
    ).toBe(true);
  });
});

describe('parseTravelGroupAuditArgs', () => {
  it('defaults to a read-only full audit', () => {
    expect(parseTravelGroupAuditArgs([])).toEqual({ repair: false });
  });

  it('recognizes repair only when the flag is explicit and rejects other arguments', () => {
    expect(parseTravelGroupAuditArgs(['--repair'])).toEqual({ repair: true });
    expect(() => parseTravelGroupAuditArgs(['--user-id=private-user-id'])).toThrow(
      'Unknown travel group audit argument',
    );
  });
});

describe('summarizeTravelGroupIntegrityAudit', () => {
  it('reports affected-user counts without retaining user identifiers', () => {
    const result = summarizeTravelGroupIntegrityAudit([
      {
        crossUserBindingCount: 0,
        defaultGroupCount: 0,
        groupVisibility: null,
        missingOrDisabledRequiredMemberCount: 4,
        platformManagedIdentityAbnormal: true,
        supervisorCount: 0,
        supervisorTitle: null,
      },
      {
        crossUserBindingCount: 2,
        defaultGroupCount: 2,
        groupVisibility: 'public',
        missingOrDisabledRequiredMemberCount: 1,
        platformManagedIdentityAbnormal: true,
        supervisorCount: 2,
        supervisorTitle: 'Other',
      },
      {
        crossUserBindingCount: 0,
        defaultGroupCount: 1,
        groupVisibility: 'private',
        missingOrDisabledRequiredMemberCount: 0,
        platformManagedIdentityAbnormal: false,
        supervisorCount: 1,
        supervisorTitle: '旅游群主AI',
      },
    ]);

    expect(result).toEqual({
      crossUserBindingCount: 2,
      duplicateDefaultGroupUserCount: 1,
      invalidSupervisorCountUserCount: 2,
      missingDefaultGroupUserCount: 1,
      missingOrDisabledRequiredMemberUserCount: 2,
      nonPrivateDefaultGroupUserCount: 1,
      platformManagedIdentityAbnormalUserCount: 2,
      supervisorTitleMismatchUserCount: 0,
      verifiedUnbannedUserCount: 3,
    });
    expect(JSON.stringify(result)).not.toContain('private-user-id');
  });
});

describe('runTravelGroupIntegrityAudit', () => {
  it('inspects every eligible user but returns aggregate data only', async () => {
    const listEligibleUserIds = vi.fn().mockResolvedValue(['user-a-private', 'user-b-private']);
    const inspect = vi.fn().mockResolvedValue({
      crossUserBindingCount: 0,
      defaultGroupCount: 1,
      groupVisibility: 'private',
      missingOrDisabledRequiredMemberCount: 0,
      platformManagedIdentityAbnormal: false,
      supervisorCount: 1,
      supervisorTitle: '旅游群主AI',
    });

    const result = await runTravelGroupIntegrityAudit({ inspect, listEligibleUserIds });

    expect(result).toMatchObject({
      missingDefaultGroupUserCount: 0,
      verifiedUnbannedUserCount: 2,
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('user-a-private');
    expect(JSON.stringify(result)).not.toContain('user-b-private');
  });
});

describe('summarizeTravelGroupAudit', () => {
  it('returns aggregate counts without user identifiers', () => {
    const result = summarizeTravelGroupAudit({
      checks: [
        { groupVisibility: 'private', ready: true },
        { groupVisibility: null, ready: false },
        { groupVisibility: 'public', ready: false },
      ],
      crossUserBindingCount: 1,
      defaultGroupCounts: [1, 0, 2],
      disabledDefaultMemberCount: 2,
    });

    expect(result).toEqual({
      crossUserBindingCount: 1,
      defaultGroupCount: 3,
      disabledDefaultMemberCount: 2,
      duplicateGroupUserCount: 1,
      missingGroupUserCount: 1,
      nonPrivateGroupUserCount: 1,
      readyUserCount: 1,
      userCount: 3,
    });
    expect(JSON.stringify(result)).not.toContain('user-');
  });

  it('does not expose database errors or credentials in failure output', () => {
    const message = safeAuditFailureMessage(
      new Error('connection failed for postgres://private-user:private-token@database/internal'),
    );

    expect(message).toBe('Travel service group audit failed');
    expect(message).not.toContain('private');
    expect(message).not.toContain('postgres');
  });

  it('inspects only the explicitly named user', async () => {
    const inspect = vi.fn().mockResolvedValue({
      check: { groupVisibility: 'private', ready: true },
      crossUserBindingCount: 0,
      defaultGroupCount: 1,
      disabledDefaultMemberCount: 0,
    });

    const result = await runScopedTravelGroupAudit('a@example.test', inspect);

    expect(result).toEqual({
      crossUserBindingCount: 0,
      defaultGroupCount: 1,
      disabledDefaultMemberCount: 0,
      duplicateGroupUserCount: 0,
      missingGroupUserCount: 0,
      nonPrivateGroupUserCount: 0,
      readyUserCount: 1,
      userCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('a@example.test');
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith('a@example.test');
    expect(JSON.stringify(inspect.mock.calls)).not.toContain('b@example.test');
  });
});
