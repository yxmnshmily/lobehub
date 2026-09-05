import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoService } from '@/services/video';

import type { VideoStore } from '../../store';
import { CreateVideoActionImpl } from './action';

vi.mock('@/business/client/handleGenerationPromptModerationError', () => ({
  handleGenerationPromptModerationError: vi.fn(),
}));

vi.mock('@/business/client/handleLobeHubModelDeprecatedError', () => ({
  handleLobeHubModelDeprecatedError: vi.fn(),
}));

vi.mock('@/services/video', () => ({
  videoService: { createVideo: vi.fn() },
}));

const createAction = (overrides: Partial<VideoStore> = {}) => {
  let state = {
    activeGenerationTopicId: 'topic-1',
    createGenerationTopic: vi.fn(),
    generationBatchesMap: {},
    isCreating: false,
    isCreatingWithNewTopic: false,
    model: 'video-model',
    parameters: { prompt: 'A Tibet travel film' },
    parametersSchema: {},
    provider: 'video-provider',
    refreshGenerationBatches: vi.fn(),
    removeGenerationBatch: vi.fn(),
    setTopicBatchLoaded: vi.fn(),
    switchGenerationTopic: vi.fn(),
    ...overrides,
  } as unknown as VideoStore;

  const set = vi.fn((patch: Partial<VideoStore> | ((current: VideoStore) => Partial<VideoStore>)) => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...next };
  });

  return {
    action: new CreateVideoActionImpl(set as never, () => state),
    getState: () => state,
  };
};

describe('CreateVideoAction loading recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(videoService.createVideo).mockResolvedValue(undefined as never);
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps loading until a successful creation has refreshed its batch', async () => {
    let finishRefresh: (() => void) | undefined;
    const refreshGenerationBatches = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const { action, getState } = createAction({ refreshGenerationBatches });

    const creation = action.createVideo();

    await vi.waitFor(() => expect(refreshGenerationBatches).toHaveBeenCalledTimes(1));
    expect(getState().isCreating).toBe(true);
    expect(getState().parameters?.prompt).toBe('A Tibet travel film');

    finishRefresh?.();
    await creation;

    expect(videoService.createVideo).toHaveBeenCalledWith({
      generationTopicId: 'topic-1',
      model: 'video-model',
      params: { prompt: 'A Tibet travel film' },
      provider: 'video-provider',
    });
    expect(getState().parameters?.prompt).toBe('');
    expect(getState().isCreating).toBe(false);
  });

  it('retains the prompt and returns to idle after a service failure so retry can succeed', async () => {
    vi.mocked(videoService.createVideo)
      .mockRejectedValueOnce(new Error('Video service failed'))
      .mockResolvedValueOnce(undefined as never);
    const { action, getState } = createAction();

    await expect(action.createVideo()).rejects.toThrow('Video service failed');
    expect(getState().isCreating).toBe(false);
    expect(getState().parameters?.prompt).toBe('A Tibet travel film');
    expect(getState().refreshGenerationBatches).not.toHaveBeenCalled();

    await action.createVideo();

    expect(videoService.createVideo).toHaveBeenCalledTimes(2);
    expect(getState().refreshGenerationBatches).toHaveBeenCalledTimes(1);
    expect(getState().parameters?.prompt).toBe('');
    expect(getState().isCreating).toBe(false);
  });

  it('does not turn a completed video creation into a retryable failure when refresh fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { action, getState } = createAction({
      refreshGenerationBatches: vi.fn().mockRejectedValue(new Error('Refresh failed')),
    });

    await expect(action.createVideo()).resolves.toBeUndefined();

    expect(videoService.createVideo).toHaveBeenCalledTimes(1);
    expect(getState().parameters?.prompt).toBe('');
    expect(getState().isCreating).toBe(false);
  });

  it('does not leave the workspace creating when parameters are unavailable', async () => {
    const { action, getState } = createAction({ parameters: undefined as never });

    await expect(action.createVideo()).rejects.toThrow('parameters is not initialized');

    expect(getState().isCreating).toBe(false);
  });

  it('clears the creating state when a new topic cannot be created', async () => {
    const { action, getState } = createAction({
      activeGenerationTopicId: null,
      createGenerationTopic: vi.fn().mockRejectedValue(new Error('Topic creation failed')),
    });

    await expect(action.createVideo()).rejects.toThrow('Topic creation failed');

    expect(getState().isCreating).toBe(false);
    expect(getState().isCreatingWithNewTopic).toBe(false);
  });

  it('does not enter the creating state when no active topic can be regenerated', async () => {
    const { action, getState } = createAction({ activeGenerationTopicId: null });

    await expect(action.recreateVideo('batch-1')).rejects.toThrow('No active generation topic');

    expect(getState().isCreating).toBe(false);
  });
});
