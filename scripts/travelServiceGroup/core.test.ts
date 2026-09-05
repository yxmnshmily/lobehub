import { describe, expect, it, vi } from 'vitest';

import {
  parseExactUserIdArg,
  parseTravelGroupCommandArgs,
  parseTravelGroupRepairPlanDryRunArgs,
  runTravelGroupCommand,
  summarizeTravelGroupCommandResult,
  summarizeTravelGroupRepairPlanDryRun,
  TRAVEL_GROUP_BOOTSTRAP_CONFIRMATION,
} from './core';

describe('travelServiceGroup command', () => {
  it('defaults to a read-only check and requires an exact user id', () => {
    expect(() => parseTravelGroupCommandArgs(['check'])).toThrow(/--user-id/);
    expect(() =>
      parseTravelGroupCommandArgs(['check', '--user-id=user-1', '--user-id=user-2']),
    ).toThrow(/exactly one/);
    expect(parseTravelGroupCommandArgs(['--user-id=user-1'])).toEqual({
      mode: 'check',
      userId: 'user-1',
    });
    expect(parseTravelGroupCommandArgs(['check', '--user-id=user-1'])).toEqual({
      mode: 'check',
      userId: 'user-1',
    });
  });

  it('requires the exact confirmation token before bootstrap can write', () => {
    expect(() => parseTravelGroupCommandArgs(['bootstrap', '--user-id=user-1'])).toThrow(
      /confirmation/,
    );
    expect(() =>
      parseTravelGroupCommandArgs(['bootstrap', '--user-id=user-1', '--confirm=wrong-token']),
    ).toThrow(/confirmation/);
    expect(
      parseTravelGroupCommandArgs([
        'bootstrap',
        '--user-id=user-1',
        `--confirm=${TRAVEL_GROUP_BOOTSTRAP_CONFIRMATION}`,
      ]),
    ).toEqual({ mode: 'bootstrap', userId: 'user-1' });
  });

  it('accepts the package-manager argument separator', () => {
    expect(parseExactUserIdArg(['--', '--user-id=user-1'])).toBe('user-1');
    expect(parseTravelGroupCommandArgs(['--', 'check', '--user-id=user-1'])).toEqual({
      mode: 'check',
      userId: 'user-1',
    });
  });

  it('checks only the named user without bootstrapping', async () => {
    const bootstrap = vi.fn();
    const check = vi.fn().mockResolvedValue({ ready: false });

    await runTravelGroupCommand(
      { mode: 'check', userId: 'user-1' },
      { bootstrap, check, userExists: vi.fn().mockResolvedValue(true) },
    );

    expect(bootstrap).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledWith('user-1');
  });

  it('bootstraps and verifies only the named existing user', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue({ ready: true });

    const result = await runTravelGroupCommand(
      { mode: 'bootstrap', userId: 'user-2' },
      { bootstrap, check, userExists: vi.fn().mockResolvedValue(true) },
    );

    expect(bootstrap).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledWith('user-2');
    expect(check).toHaveBeenCalledWith('user-2');
    expect(result).toEqual({ ready: true });
  });

  it('refuses an unknown user before any write', async () => {
    const bootstrap = vi.fn();
    const check = vi.fn();

    await expect(
      runTravelGroupCommand(
        { mode: 'bootstrap', userId: 'missing' },
        { bootstrap, check, userExists: vi.fn().mockResolvedValue(false) },
      ),
    ).rejects.toThrow(/does not exist/);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it('reduces command output to counts and non-sensitive identifiers', () => {
    const result = summarizeTravelGroupCommandResult('user-1', {
      email: 'private@example.com',
      groupId: 'group-1',
      memberCount: 5,
      missingSkillBindings: ['tourism-copywriting'],
      missingSpecialistClientIds: [],
      prompt: 'private group instructions',
      ready: true,
      supervisorAgentId: 'agent-1',
      supervisorCount: 1,
      supervisorTitle: '私人群名',
      token: 'private-token',
    });

    expect(result).toEqual({
      groupId: 'group-1',
      memberCount: 5,
      missingFixedModelSelectionCount: 0,
      missingPlatformManagedRuntimeCount: 0,
      missingSkillBindingCount: 1,
      missingSkillIdentifierCount: 0,
      missingSpecialistCount: 0,
      missingToolBindingCount: 0,
      readyCount: 1,
      supervisorAgentId: 'agent-1',
      supervisorCount: 1,
      userId: 'user-1',
    });
    const output = JSON.stringify(result);
    expect(output).not.toContain('private');
    expect(output).not.toContain('私人群名');
  });
});

describe('travel service group repair plan dry-run', () => {
  it('accepts no operation flags and rejects repair explicitly', () => {
    expect(parseTravelGroupRepairPlanDryRunArgs([])).toEqual({ dryRun: true });
    expect(parseTravelGroupRepairPlanDryRunArgs(['--'])).toEqual({ dryRun: true });
    expect(() => parseTravelGroupRepairPlanDryRunArgs(['--repair'])).toThrow(
      /Repair execution is not available/,
    );
    expect(() => parseTravelGroupRepairPlanDryRunArgs(['--user-id=private-user'])).toThrow(
      /Unknown repair plan dry-run argument/,
    );
  });

  it('reduces plans to fixed aggregate action counts without targets or source details', () => {
    const result = summarizeTravelGroupRepairPlanDryRun([
      {
        actions: [
          { code: 'SET_PRIVATE', reviewRequired: false, target: 'group' },
          { code: 'MARK_PLATFORM_MANAGED', reviewRequired: false, target: 'copywriter' },
        ],
        reviewRequired: false,
        sourceDetails: { prompt: 'private prompt', userId: 'private-user' },
      },
      {
        actions: [
          {
            code: 'REMOVE_DUPLICATE_REVIEW_REQUIRED',
            reviewRequired: true,
            target: 'group',
          },
        ],
        reviewRequired: true,
      },
    ]);

    expect(result).toEqual({
      actionCounts: {
        CREATE_DEFAULT_GROUP: 0,
        ENABLE_REQUIRED_MEMBER: 0,
        ENSURE_REQUIRED_MEMBER: 0,
        ENSURE_SUPERVISOR: 0,
        MARK_PLATFORM_MANAGED: 1,
        REMOVE_DUPLICATE_REVIEW_REQUIRED: 1,
        RENAME_SUPERVISOR: 0,
        SET_PRIVATE: 1,
        SUPERVISOR_REVIEW_REQUIRED: 0,
        UNKNOWN_ISSUE_REVIEW_REQUIRED: 0,
      },
      totalActionCount: 3,
    });
    expect(JSON.stringify(result)).not.toContain('private-user');
    expect(JSON.stringify(result)).not.toContain('copywriter');
    expect(JSON.stringify(result)).not.toContain('prompt');
  });
});
