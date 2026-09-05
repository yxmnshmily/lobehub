import {
  DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES,
  type DefaultTravelServiceGroupRepairActionCode,
} from '../../apps/server/src/services/user/travelServiceGroup';

export type TravelGroupCommandMode = 'bootstrap' | 'check';
export const TRAVEL_GROUP_BOOTSTRAP_CONFIRMATION = 'BOOTSTRAP_DEFAULT_TRAVEL_GROUP';

export interface TravelGroupCommandArgs {
  mode: TravelGroupCommandMode;
  userId: string;
}

const arrayCount = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const numericCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
const safeId = (value: unknown) => (typeof value === 'string' ? value : null);

export const summarizeTravelGroupCommandResult = (
  userId: string,
  result: Record<string, unknown>,
) => ({
  groupId: safeId(result.groupId),
  memberCount: numericCount(result.memberCount),
  missingFixedModelSelectionCount: arrayCount(result.missingFixedModelSelectionClientIds),
  missingPlatformManagedRuntimeCount: arrayCount(result.missingPlatformManagedRuntimeClientIds),
  missingSkillBindingCount: arrayCount(result.missingSkillBindings),
  missingSkillIdentifierCount: arrayCount(result.missingSkillIdentifiers),
  missingSpecialistCount: arrayCount(result.missingSpecialistClientIds),
  missingToolBindingCount: arrayCount(result.missingToolBindings),
  readyCount: result.ready === true ? 1 : 0,
  supervisorAgentId: safeId(result.supervisorAgentId),
  supervisorCount: numericCount(result.supervisorCount),
  userId,
});

const withoutPackageManagerSeparator = (args: string[]) => args.filter((arg) => arg !== '--');

export const parseTravelGroupRepairPlanDryRunArgs = (rawArgs: string[]) => {
  const args = withoutPackageManagerSeparator(rawArgs);
  if (args.includes('--repair')) {
    throw new Error('Repair execution is not available; this command is dry-run only');
  }
  if (args.length > 0) {
    throw new Error(`Unknown repair plan dry-run argument: ${args[0]}`);
  }
  return { dryRun: true as const };
};

export const summarizeTravelGroupRepairPlanDryRun = (
  plans: Array<{
    actions: Array<{ code: DefaultTravelServiceGroupRepairActionCode; [key: string]: unknown }>;
    [key: string]: unknown;
  }>,
) => {
  const actionCounts = Object.fromEntries(
    DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES.map((code) => [code, 0]),
  ) as Record<DefaultTravelServiceGroupRepairActionCode, number>;
  const knownActionCodes = new Set<string>(DEFAULT_TRAVEL_SERVICE_GROUP_REPAIR_ACTION_CODES);
  let totalActionCount = 0;

  for (const plan of plans) {
    for (const action of plan.actions) {
      const code = knownActionCodes.has(action.code)
        ? action.code
        : 'UNKNOWN_ISSUE_REVIEW_REQUIRED';
      actionCounts[code] += 1;
      totalActionCount += 1;
    }
  }

  return { actionCounts, totalActionCount };
};

export const parseExactUserIdArg = (rawArgs: string[]): string => {
  const args = withoutPackageManagerSeparator(rawArgs);
  const userArgs = args.filter((arg) => arg.startsWith('--user-id='));
  if (args.length !== 1 || userArgs.length !== 1) {
    throw new Error('pass exactly one user with --user-id=<id>');
  }
  const userId = userArgs[0].slice('--user-id='.length);
  if (!userId || userId.trim() !== userId || userId.length > 255) {
    throw new Error('pass one exact existing user ID with --user-id=<id>');
  }
  return userId;
};

export const parseTravelGroupCommandArgs = (rawArgs: string[]): TravelGroupCommandArgs => {
  const args = withoutPackageManagerSeparator(rawArgs);
  const explicitMode = args[0] === 'check' || args[0] === 'bootstrap';
  const mode: TravelGroupCommandMode = explicitMode ? (args[0] as TravelGroupCommandMode) : 'check';
  const optionArgs = explicitMode ? args.slice(1) : args;

  const userArgs = optionArgs.filter((arg) => arg.startsWith('--user-id='));
  if (userArgs.length !== 1) {
    throw new Error('pass exactly one user with --user-id=<id>');
  }
  const userId = userArgs[0].slice('--user-id='.length);
  if (!userId || userId.trim() !== userId || userId.length > 255) {
    throw new Error('pass one exact existing user ID with --user-id=<id>');
  }

  if (mode === 'bootstrap') {
    const confirmation = `--confirm=${TRAVEL_GROUP_BOOTSTRAP_CONFIRMATION}`;
    if (optionArgs.length !== 2 || optionArgs[1] !== confirmation) {
      throw new Error(`bootstrap requires exact confirmation: ${confirmation}`);
    }
  } else if (optionArgs.length !== 1) {
    throw new Error('check accepts only --user-id=<id>');
  }

  return { mode, userId };
};

export const runTravelGroupCommand = async <T>(
  args: TravelGroupCommandArgs,
  dependencies: {
    bootstrap: (userId: string) => Promise<void>;
    check: (userId: string) => Promise<T>;
    userExists: (userId: string) => Promise<boolean>;
  },
): Promise<T> => {
  if (!(await dependencies.userExists(args.userId))) {
    throw new Error(`user does not exist: ${args.userId}`);
  }
  if (args.mode === 'bootstrap') await dependencies.bootstrap(args.userId);
  return dependencies.check(args.userId);
};
