// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { TravelGenerationTaskModel } from '@/database/models/travelGeneration';
import { FileService } from '@/server/services/file';

const mocks = vi.hoisted(() => ({
  activeUserId: 'user-1',
  db: {},
  fetch: vi.fn(),
  fileService: { createCachedPreSignedUrlForPreview: vi.fn() },
  findFile: vi.fn(),
  findGeneration: vi.fn(),
  isSettled: vi.fn(),
  findTask: vi.fn(),
}));

vi.mock('@/app/(backend)/middleware/auth', () => ({
  checkAuth: (handler: any) => (request: Request, options: any) =>
    handler(request, { ...options, serverDB: mocks.db, userId: mocks.activeUserId }),
}));
vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({ findById: mocks.findFile })),
}));
vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn(() => ({ findByIdWithAsyncTask: mocks.findGeneration })),
}));
vi.mock('@/database/models/travelGeneration', () => ({
  TravelGenerationTaskModel: vi.fn(() => ({ findById: mocks.findTask })),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => mocks.fileService),
}));
vi.mock('@/server/services/travelGeneration/artifactAccess', () => ({
  hasSettledTravelImageUsage: mocks.isSettled,
}));

const invoke = async ({
  artifactId = 'generation-1',
  headers,
  query = 'workspaceId=workspace-1',
}: {
  artifactId?: string;
  headers?: HeadersInit;
  query?: string;
} = {}) => {
  const { GET } = await import('./route');
  return GET(
    new Request(
      `https://lobehub.test/api/travel-generation/artifacts/task-1/${artifactId}?${query}`,
      { headers },
    ),
    { params: Promise.resolve({ artifactId, taskId: 'task-1' }) },
  );
};

describe('authenticated travel generation artifact access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.activeUserId = 'user-1';
    mocks.findTask.mockResolvedValue({
      artifacts: [{ generationId: 'generation-1', type: 'image', url: '/f/file-1' }],
      id: 'task-1',
      status: 'succeeded',
      type: 'image',
    });
    mocks.findGeneration.mockResolvedValue({
      asset: { type: 'image', url: 'users/user-1/travel-cover.png' },
      asyncTask: { id: 'async-task-1', status: 'success' },
      fileId: 'file-1',
      id: 'generation-1',
    });
    mocks.findFile.mockResolvedValue({
      fileType: 'image/png',
      id: 'file-1',
      metadata: { generationId: 'generation-1' },
      name: 'travel-cover.png',
      url: 'users/user-1/travel-cover.png',
    });
    mocks.fileService.createCachedPreSignedUrlForPreview.mockResolvedValue(
      'https://storage.test/signed-owner-preview',
    );
    mocks.isSettled.mockResolvedValue(true);
    mocks.fetch.mockResolvedValue(
      new Response(Uint8Array.from([137, 80, 78, 71]), {
        headers: {
          'Content-Length': '4',
          'Content-Type': 'text/html',
          'Set-Cookie': 'storage-secret=1',
        },
        status: 200,
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('streams an owned settled workspace image with controlled response headers', async () => {
    const response = await invoke();

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe(
      "inline; filename*=UTF-8''travel-cover.png",
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([137, 80, 78, 71]);
    expect(TravelGenerationTaskModel).toHaveBeenCalledWith(mocks.db, 'user-1', 'workspace-1');
    expect(GenerationModel).toHaveBeenCalledWith(mocks.db, 'user-1', 'workspace-1');
    expect(FileModel).toHaveBeenCalledWith(mocks.db, 'user-1', 'workspace-1');
    expect(FileService).toHaveBeenCalledWith(mocks.db, 'user-1', 'workspace-1');
    expect(mocks.fileService.createCachedPreSignedUrlForPreview).toHaveBeenCalledWith(
      'users/user-1/travel-cover.png',
    );
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://storage.test/signed-owner-preview',
      expect.objectContaining({ headers: {}, redirect: 'error' }),
    );
  });

  it('forwards one valid byte range and exposes only validated range headers', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(Uint8Array.from([137, 80]), {
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': '2',
          'Content-Range': 'bytes 0-1/4',
          'ETag': 'storage-internal-etag',
        },
        status: 206,
      }),
    );

    const response = await invoke({ headers: { Range: 'bytes=0-1' } });

    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe('bytes 0-1/4');
    expect(response.headers.get('content-length')).toBe('2');
    expect(response.headers.get('etag')).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://storage.test/signed-owner-preview',
      expect.objectContaining({ headers: { Range: 'bytes=0-1' }, redirect: 'error' }),
    );
  });

  it('uses a controlled attachment disposition without requesting another storage URL', async () => {
    const response = await invoke({ query: 'workspaceId=workspace-1&download=1' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''travel-cover.png",
    );
    expect(mocks.fileService.createCachedPreSignedUrlForPreview).toHaveBeenCalledOnce();
  });

  it.each(['queued', 'running', 'pending', 'failed', 'unavailable', 'cancelled'])(
    'returns the same not-found response for a %s travel task',
    async (status) => {
      mocks.findTask.mockResolvedValue({
        artifacts: [{ generationId: 'generation-1', type: 'image', url: '/f/file-1' }],
        id: 'task-1',
        status,
      });

      const response = await invoke();

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Artifact not found');
      expect(mocks.findGeneration).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'processing', 'error'])(
    'returns not-found when the underlying async generation is %s and therefore unsettled',
    async (status) => {
      mocks.findGeneration.mockResolvedValue({
        asset: { type: 'image', url: 'users/user-1/travel-cover.png' },
        asyncTask: { id: 'async-task-1', status },
        fileId: 'file-1',
        id: 'generation-1',
      });

      const response = await invoke();

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Artifact not found');
      expect(mocks.findFile).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it('returns not-found when no durable usage settlement matches the owner and generation', async () => {
    mocks.isSettled.mockResolvedValue(false);

    const response = await invoke();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(mocks.findFile).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when durable settlement lookup is unavailable', async () => {
    mocks.isSettled.mockRejectedValue(new Error('database internal detail'));

    const response = await invoke();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(mocks.findFile).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns the same not-found response for a cross-user task', async () => {
    mocks.activeUserId = 'user-2';
    mocks.findTask.mockResolvedValue(undefined);

    const response = await invoke();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(mocks.findGeneration).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('returns the same not-found response for a cross-workspace task', async () => {
    mocks.findTask.mockResolvedValue(undefined);

    const response = await invoke({ query: 'workspaceId=workspace-2' });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(TravelGenerationTaskModel).toHaveBeenCalledWith(mocks.db, 'user-1', 'workspace-2');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('cannot jump to a generation that is not recorded on the owned task', async () => {
    const response = await invoke({ artifactId: 'generation-2' });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(mocks.findGeneration).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'mismatched task record',
      {
        artifacts: [{ generationId: 'generation-1', type: 'image', url: '/f/file-1' }],
        id: 'task-2',
        status: 'succeeded',
        type: 'image',
      },
    ],
    [
      'non-image task',
      {
        artifacts: [{ generationId: 'generation-1', type: 'image', url: '/f/file-1' }],
        id: 'task-1',
        status: 'succeeded',
        type: 'document',
      },
    ],
    [
      'multiple successful artifacts',
      {
        artifacts: [
          { generationId: 'generation-1', type: 'image', url: '/f/file-1' },
          { generationId: 'generation-2', type: 'image', url: '/f/file-2' },
        ],
        id: 'task-1',
        status: 'succeeded',
        type: 'image',
      },
    ],
  ])('rejects a %s before generation access', async (_label, task) => {
    mocks.findTask.mockResolvedValue(task);

    const response = await invoke();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(mocks.findGeneration).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['path traversal', { artifactId: '../generation-1' }],
    ['multiple ranges', { headers: { Range: 'bytes=0-1,2-3' } }],
    ['signature query', { query: 'workspaceId=workspace-1&X-Amz-Signature=forged' }],
    ['repeated workspace', { query: 'workspaceId=workspace-1&workspaceId=workspace-2' }],
    ['invalid download', { query: 'workspaceId=workspace-1&download=0' }],
  ])('uniformly rejects %s input before storage access', async (_label, options) => {
    const response = await invoke(options);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Artifact not found');
    expect(mocks.fileService.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects executable content types before storage access', async () => {
    mocks.findFile.mockResolvedValue({
      fileType: 'image/svg+xml',
      id: 'file-1',
      metadata: { generationId: 'generation-1' },
      name: 'travel-cover.svg',
      url: 'users/user-1/travel-cover.svg',
    });

    const response = await invoke();

    expect(response.status).toBe(404);
    expect(mocks.fileService.createCachedPreSignedUrlForPreview).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['signing', 'fetching'])(
    'fails closed when storage %s fails without redirecting or retrying',
    async (stage) => {
      if (stage === 'signing') {
        mocks.fileService.createCachedPreSignedUrlForPreview.mockRejectedValue(
          new Error('storage secret'),
        );
      } else {
        mocks.fetch.mockRejectedValue(new Error('storage secret'));
      }

      const response = await invoke();

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Artifact not found');
      expect(response.headers.get('location')).toBeNull();
      expect(mocks.fileService.createCachedPreSignedUrlForPreview).toHaveBeenCalledTimes(1);
      expect(mocks.fetch).toHaveBeenCalledTimes(stage === 'fetching' ? 1 : 0);
    },
  );
});
