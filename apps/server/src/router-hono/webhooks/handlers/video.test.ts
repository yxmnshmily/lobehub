import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { videoWebhook } from './video';

const mocks = vi.hoisted(() => ({
  chargeUsage: vi.fn(),
  createAsset: vi.fn(),
  findTask: vi.fn(),
  ledger: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@lobechat/database', () => ({
  PlatformCreditModel: mocks.ledger,
}));
vi.mock('@lobechat/business-model-runtime', () => ({
  buildMappedBusinessModelFields: () => ({}),
  resolveBusinessModelMapping: async () => ({ resolvedModelId: 'video-model' }),
}));
vi.mock('@lobechat/model-runtime', () => ({
  ModelRuntime: {
    initializeWithProvider: () => ({
      handleCreateVideoWebhook: async () => ({
        inferenceId: 'inference-1',
        status: 'success',
        videoUrl: 'https://example.com/video.mp4',
        usage: { completionTokens: 100, totalTokens: 100 },
      }),
    }),
  },
  computeVideoCost: () => ({ totalCost: 0.001 }),
  getModelPricing: async () => ({}),
}));
vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: Object.assign(
    vi.fn().mockImplementation(function () {
      return { update: mocks.update };
    }),
    {
      findByInferenceId: mocks.findTask,
    },
  ),
}));
vi.mock('@/database/models/generation', () => ({
  GenerationModel: vi.fn().mockImplementation(function () {
    return {
      findByAsyncTaskId: async () => ({ id: 'generation-1', generationBatchId: 'batch-1' }),
      createAssetAndFile: mocks.createAsset,
    };
  }),
}));
vi.mock('@/database/server', () => ({
  getServerDB: async () => ({
    query: {
      generationBatches: {
        findFirst: async () => ({ model: 'video-model', prompt: 'travel', config: {} }),
      },
    },
  }),
}));
vi.mock('@/server/services/generation/video', () => ({
  VideoGenerationService: vi.fn().mockImplementation(function () {
    return {
      processVideoForGeneration: async () => ({
        videoKey: 'video.mp4',
        duration: 5,
        width: 720,
        height: 1280,
      }),
    };
  }),
}));
vi.mock('@/business/server/video-generation/chargeAfterGenerate', () => ({
  chargeAfterGenerate: vi.fn(),
}));
vi.mock('@/business/server/video-generation/notifyVideoCompleted', () => ({
  notifyVideoCompleted: vi.fn(),
}));
vi.mock('@/server/services/notification/generation', () => ({ notifyGenerationFailed: vi.fn() }));
vi.mock('@/server/services/notification/credit', () => ({ notifyCreditEntry: vi.fn() }));

describe('video webhook platform settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ledger.mockImplementation(function () {
      return { chargeUsage: mocks.chargeUsage };
    });
    mocks.chargeUsage.mockResolvedValue({ id: 'credit-entry' });
  });

  it.each([undefined, 'workspace-1'])(
    'settles the callback in its original scope (%s) once',
    async (workspaceId) => {
      const task = {
        id: 'task-1',
        userId: 'user-1',
        workspaceId,
        createdAt: new Date(),
        status: 'processing',
        metadata: { webhookToken: 'test-token', platformAiRuntime: true },
      };
      mocks.findTask.mockResolvedValue(task);
      mocks.update.mockImplementation(async (_id, update) => Object.assign(task, update));
      const app = new Hono().post('/video/:provider', videoWebhook);
      const request = () =>
        app.request('/video/provider-1?token=test-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      expect((await request()).status).toBe(200);
      expect(mocks.chargeUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          workspaceId,
          costUsd: 0.001,
          credits: 1000,
          generationId: 'generation-1:async-task:task-1:video',
          provider: 'provider-1',
          model: 'video-model',
        }),
      );
      expect((await request()).status).toBe(200);
      expect(mocks.chargeUsage).toHaveBeenCalledTimes(1);
      expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    },
  );
});
