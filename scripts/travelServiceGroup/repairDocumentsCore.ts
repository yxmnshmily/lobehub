export const REPAIR_TRAVEL_DOCUMENTS_CONFIRMATION = 'REPAIR_TRAVEL_DOCUMENTS';

export interface TravelDocumentRepairArgs {
  apply: boolean;
  userId: string;
}

export interface TravelDocumentRepairCandidate {
  content: null | string;
  filename?: null | string;
  fileType: string;
  id: string;
  source: string;
  title?: null | string;
  userId: string;
}

export const parseTravelDocumentRepairArgs = (rawArgs: string[]): TravelDocumentRepairArgs => {
  const args = rawArgs.filter((arg) => arg !== '--');
  const userArgs = args.filter((arg) => arg.startsWith('--user-id='));
  if (userArgs.length !== 1) throw new Error('pass exactly one user with --user-id=<id>');

  const userId = userArgs[0].slice('--user-id='.length);
  if (!userId || userId.trim() !== userId || userId.length > 255) {
    throw new Error('pass one exact existing user ID with --user-id=<id>');
  }

  const apply = args.includes('--apply');
  if (!apply) {
    if (args.length !== 1) throw new Error('dry-run accepts only --user-id=<id>');
    return { apply: false, userId };
  }

  const confirmation = `--confirm=${REPAIR_TRAVEL_DOCUMENTS_CONFIRMATION}`;
  if (args.length !== 3 || args.filter((arg) => arg === '--apply').length !== 1) {
    throw new Error(`apply requires exact confirmation: ${confirmation}`);
  }
  if (!args.includes(confirmation)) {
    throw new Error(`apply requires exact confirmation: ${confirmation}`);
  }
  return { apply: true, userId };
};

export const runTravelDocumentRepair = async (
  args: TravelDocumentRepairArgs,
  dependencies: {
    canRepair: (userId: string) => Promise<boolean>;
    listDocuments: (userId: string) => Promise<TravelDocumentRepairCandidate[]>;
    repair: (document: TravelDocumentRepairCandidate) => Promise<boolean>;
  },
) => {
  if (!(await dependencies.canRepair(args.userId))) {
    throw new Error('account is not eligible for repair');
  }
  const documents = await dependencies.listDocuments(args.userId);
  const candidates = documents.filter(
    ({ fileType, source, userId }) =>
      userId === args.userId && source === 'travel-generation' && fileType === 'markdown',
  );
  if (!args.apply) {
    return { candidateCount: candidates.length, repairedCount: 0, userId: args.userId };
  }

  let repairedCount = 0;
  for (const document of candidates) {
    if (await dependencies.repair(document)) repairedCount += 1;
  }
  return { candidateCount: candidates.length, repairedCount, userId: args.userId };
};
