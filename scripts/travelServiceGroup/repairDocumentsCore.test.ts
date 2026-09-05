import { describe, expect, it, vi } from 'vitest';

import {
  parseTravelDocumentRepairArgs,
  REPAIR_TRAVEL_DOCUMENTS_CONFIRMATION,
  runTravelDocumentRepair,
} from './repairDocumentsCore';

describe('travel document repair command', () => {
  it('defaults to dry-run for one explicit user', () => {
    expect(parseTravelDocumentRepairArgs(['--user-id=user-1'])).toEqual({
      apply: false,
      userId: 'user-1',
    });
    expect(() => parseTravelDocumentRepairArgs([])).toThrow(/--user-id/);
  });

  it('requires an exact confirmation token before applying repairs', () => {
    expect(() => parseTravelDocumentRepairArgs(['--user-id=user-1', '--apply'])).toThrow(
      /confirmation/,
    );
    expect(() =>
      parseTravelDocumentRepairArgs(['--user-id=user-1', '--apply', '--confirm=wrong-token']),
    ).toThrow(/confirmation/);
    expect(
      parseTravelDocumentRepairArgs([
        '--user-id=user-1',
        '--apply',
        `--confirm=${REPAIR_TRAVEL_DOCUMENTS_CONFIRMATION}`,
      ]),
    ).toEqual({ apply: true, userId: 'user-1' });
  });

  it('repairs only eligible owned generation documents and is idempotent', async () => {
    const documents = [
      {
        content: 'eligible',
        fileType: 'markdown',
        id: 'travel-doc-1',
        source: 'travel-generation',
        userId: 'user-1',
      },
      {
        content: 'private user document',
        fileType: 'markdown',
        id: 'user-doc-1',
        source: 'user-upload',
        userId: 'user-1',
      },
      {
        content: 'other user generation document',
        fileType: 'markdown',
        id: 'travel-doc-2',
        source: 'travel-generation',
        userId: 'user-2',
      },
    ];
    const repair = vi.fn(async (document: (typeof documents)[number]) => {
      document.fileType = 'custom/document';
      return true;
    });
    const listDocuments = vi
      .fn()
      .mockImplementation(async (userId: string) =>
        documents.filter((document) => document.userId === userId),
      );
    const dependencies = {
      canRepair: vi.fn().mockResolvedValue(true),
      listDocuments,
      repair,
    };
    const args = { apply: true, userId: 'user-1' } as const;

    await expect(runTravelDocumentRepair(args, dependencies)).resolves.toEqual({
      candidateCount: 1,
      repairedCount: 1,
      userId: 'user-1',
    });
    await expect(runTravelDocumentRepair(args, dependencies)).resolves.toEqual({
      candidateCount: 0,
      repairedCount: 0,
      userId: 'user-1',
    });
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(listDocuments).toHaveBeenNthCalledWith(1, 'user-1');
    expect(listDocuments).toHaveBeenNthCalledWith(2, 'user-1');
    expect(repair).toHaveBeenCalledOnce();
    expect(repair).toHaveBeenCalledWith(expect.objectContaining({ id: 'travel-doc-1' }));
  });

  it('does not invoke repair during dry-run', async () => {
    const repair = vi.fn();

    await expect(
      runTravelDocumentRepair(
        { apply: false, userId: 'user-1' },
        {
          canRepair: vi.fn().mockResolvedValue(true),
          listDocuments: vi.fn().mockResolvedValue([
            {
              content: 'eligible',
              fileType: 'markdown',
              id: 'travel-doc-1',
              source: 'travel-generation',
              userId: 'user-1',
            },
          ]),
          repair,
        },
      ),
    ).resolves.toEqual({ candidateCount: 1, repairedCount: 0, userId: 'user-1' });
    expect(repair).not.toHaveBeenCalled();
  });

  it('does not enumerate or repair documents for an ineligible account', async () => {
    const listDocuments = vi.fn();
    const repair = vi.fn();

    await expect(
      runTravelDocumentRepair(
        { apply: true, userId: 'banned-user' },
        {
          canRepair: vi.fn().mockResolvedValue(false),
          listDocuments,
          repair,
        },
      ),
    ).rejects.toThrow('account is not eligible for repair');
    expect(listDocuments).not.toHaveBeenCalled();
    expect(repair).not.toHaveBeenCalled();
  });
});
