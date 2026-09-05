import { TRPCError } from '@trpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ImportResultData } from '@/types/importer';

import { hasActivePlatformAdminAccess } from '../_helpers/platformAdminGuard';
import { importerRouter } from '../importer';

const mockGetFileContent = vi.fn();
const mockDeleteFile = vi.fn();
const mockImportData = vi.fn();
const mockImportPgData = vi.fn();

vi.mock('@/database/repositories/dataImporter', () => ({
  DataImporterRepos: vi.fn().mockImplementation(() => ({
    importData: mockImportData,
    importPgData: mockImportPgData,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    getFileContent: mockGetFileContent,
    deleteFile: mockDeleteFile,
  })),
}));

vi.mock('../_helpers/platformAdminGuard', () => ({
  hasActivePlatformAdminAccess: vi.fn(),
}));

describe('importerRouter', () => {
  const mockFileContent = JSON.stringify({
    version: 1,
    messages: [],
  });

  const mockPgData = {
    data: {},
    mode: 'pglite' as const,
    schemaHash: 'hash',
  };

  const mockImportResult: ImportResultData = {
    success: true,
    results: { messages: { added: 1, errors: 0, skips: 0 } },
  };

  const mockImportErrorResult: ImportResultData = {
    success: false,
    error: {
      message: 'Import failed',
      details: 'Error details',
    },
    results: {},
  };

  beforeEach(() => {
    vi.mocked(hasActivePlatformAdminAccess).mockResolvedValue(false);
    mockGetFileContent.mockResolvedValue(mockFileContent);
    mockImportData.mockResolvedValue(mockImportResult);
    mockImportPgData.mockResolvedValue(mockImportResult);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const ctx = {
    userId: 'user-1',
    serverDB: {} as any,
  };

  describe('importByFile', () => {
    it('should successfully import file data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByFile({ pathname: 'test.json' });

      expect(result).toEqual(mockImportResult);
      expect(mockGetFileContent).toHaveBeenCalledWith('test.json');
      expect(mockImportData).toHaveBeenCalledWith(JSON.parse(mockFileContent));
      expect(mockDeleteFile).toHaveBeenCalledWith('test.json');
    });

    it('should handle PG data import', async () => {
      mockGetFileContent.mockResolvedValue(JSON.stringify(mockPgData));

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByFile({ pathname: 'test.json' });

      expect(result).toEqual(mockImportResult);
      expect(mockImportPgData).toHaveBeenCalledWith(mockPgData);
    });

    it('should throw error when file read fails', async () => {
      mockGetFileContent.mockRejectedValue(new Error('File read error'));

      const caller = importerRouter.createCaller(ctx);

      await expect(caller.importByFile({ pathname: 'test.json' })).rejects.toThrow(TRPCError);
    });

    it('should throw error for invalid JSON', async () => {
      mockGetFileContent.mockResolvedValue('invalid json');

      const caller = importerRouter.createCaller(ctx);

      await expect(caller.importByFile({ pathname: 'test.json' })).rejects.toThrow(TRPCError);
    });

    it('rejects an ordinary customer importing agent or group configuration before writing', async () => {
      mockGetFileContent.mockResolvedValue(
        JSON.stringify({
          data: {
            agents: [{ systemRole: 'Imported platform prompt' }],
          },
          mode: 'postgres',
          schemaHash: 'hash',
        }),
      );

      await expect(
        importerRouter.createCaller(ctx).importByFile({ pathname: 'test.json' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockImportPgData).not.toHaveBeenCalled();
      expect(mockDeleteFile).not.toHaveBeenCalled();
    });

    it('allows an active super_admin to import agent configuration from a file', async () => {
      vi.mocked(hasActivePlatformAdminAccess).mockResolvedValue(true);
      mockGetFileContent.mockResolvedValue(
        JSON.stringify({
          data: { agents: [{ systemRole: 'Platform prompt' }] },
          mode: 'postgres',
          schemaHash: 'hash',
        }),
      );

      await expect(
        importerRouter.createCaller(ctx).importByFile({ pathname: 'agents.json' }),
      ).resolves.toEqual(mockImportResult);
      expect(mockImportPgData).toHaveBeenCalledOnce();
      expect(mockDeleteFile).toHaveBeenCalledWith('agents.json');
    });
  });

  describe('importByPost', () => {
    it('should successfully import posted data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const postData = {
        data: {
          version: 1,
          messages: [],
        },
      };

      const result = await caller.importByPost(postData);

      expect(result).toEqual(mockImportResult);
      expect(mockImportData).toHaveBeenCalledWith(postData.data);
    });

    it('should handle import failure', async () => {
      mockImportData.mockResolvedValue(mockImportErrorResult);

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importByPost({
        data: {
          version: 1,
          messages: [],
        },
      });

      expect(result).toEqual(mockImportErrorResult);
    });

    it('rejects an ordinary customer importing any legacy session agent before writing', async () => {
      await expect(
        importerRouter.createCaller(ctx).importByPost({
          data: {
            sessions: [{ config: { systemRole: 'Imported prompt' }, meta: {} }],
            version: 1,
          },
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockImportData).not.toHaveBeenCalled();
    });

    it('allows an active super_admin to import legacy session agents', async () => {
      vi.mocked(hasActivePlatformAdminAccess).mockResolvedValue(true);
      const data = {
        data: {
          sessions: [{ config: { systemRole: 'Platform prompt' }, meta: {} }],
          version: 1,
        },
      };

      await expect(importerRouter.createCaller(ctx).importByPost(data)).resolves.toEqual(
        mockImportResult,
      );
      expect(mockImportData).toHaveBeenCalledWith(data.data);
    });
  });

  describe('importPgByPost', () => {
    it('should successfully import PG data', async () => {
      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importPgByPost(mockPgData);

      expect(result).toEqual(mockImportResult);
      expect(mockImportPgData).toHaveBeenCalledWith(mockPgData);
    });

    it('should handle import failure', async () => {
      mockImportPgData.mockResolvedValue(mockImportErrorResult);

      const caller = importerRouter.createCaller(ctx);

      const result = await caller.importPgByPost(mockPgData);

      expect(result).toEqual(mockImportErrorResult);
    });

    it.each([
      ['agents', { agents: [{ systemRole: 'Imported prompt' }] }],
      ['groups', { chatGroups: [{ title: 'Imported group' }] }],
      ['members', { chatGroupsAgents: [{ agentId: 'agent-1', chatGroupId: 'group-1' }] }],
      ['models', { aiModels: [{ id: 'imported-model' }] }],
      ['providers', { aiProviders: [{ id: 'imported-provider' }] }],
      ['tools', { userInstalledPlugins: [{ identifier: 'imported-tool' }] }],
      [
        'platform settings',
        { userSettings: [{ defaultAgent: { model: 'imported-model' }, id: 'user-1' }] },
      ],
    ])('rejects an ordinary customer importing PostgreSQL %s before writing', async (_, data) => {
      await expect(
        importerRouter.createCaller(ctx).importPgByPost({
          ...mockPgData,
          data,
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockImportPgData).not.toHaveBeenCalled();
    });

    it('keeps ordinary personal message imports available', async () => {
      const personalData = {
        ...mockPgData,
        data: {
          agents: [],
          messages: [{ content: 'My imported message', id: 'message-1' }],
          userSettings: [{ general: { language: 'zh-CN' }, id: 'user-1' }],
        },
      };

      await expect(importerRouter.createCaller(ctx).importPgByPost(personalData)).resolves.toEqual(
        mockImportResult,
      );
      expect(mockImportPgData).toHaveBeenCalledWith(personalData);
    });

    it('allows an active super_admin to import PostgreSQL agent configuration', async () => {
      vi.mocked(hasActivePlatformAdminAccess).mockResolvedValue(true);
      const platformData = {
        ...mockPgData,
        data: { agents: [{ systemRole: 'Platform prompt' }] },
      };

      await expect(importerRouter.createCaller(ctx).importPgByPost(platformData)).resolves.toEqual(
        mockImportResult,
      );
      expect(mockImportPgData).toHaveBeenCalledWith(platformData);
    });
  });
});
