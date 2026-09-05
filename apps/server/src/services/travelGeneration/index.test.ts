import { describe, expect, it, vi } from 'vitest';

import {
  TravelGenerationArtifactPersistenceError,
  TravelGenerationNonReplayableError,
  TravelGenerationOrchestrator,
  type TravelGenerationStatus,
} from './index';

const debugLog = vi.hoisted(() => vi.fn());

vi.mock('debug', () => ({ default: vi.fn(() => debugLog) }));

const owner = { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' };

describe('TravelGenerationOrchestrator', () => {
  it('rejects duplicate adapters instead of silently replacing configuration', () => {
    expect(
      () =>
        new TravelGenerationOrchestrator({
          adapters: [
            { execute: async () => ({ artifacts: [] }), type: 'image' },
            { execute: async () => ({ artifacts: [] }), type: 'image' },
          ],
          repository: { create: vi.fn(), update: vi.fn() },
        }),
    ).toThrow('Duplicate travel generation adapter: image');
  });

  it('persists lifecycle, artifacts, and standard ModelUsage for a successful generation', async () => {
    const update = vi.fn(async () => undefined);
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => ({
            artifacts: [{ content: '桂林旅游文案', type: 'text' }],
            provider: 'existing-llm',
            usage: {
              cost: 0.0123,
              totalInputTokens: 12,
              totalOutputTokens: 8,
              totalTokens: 20,
            },
          }),
          type: 'copy',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-1' }),
        update,
      },
    });

    const result = await orchestrator.run({ input: { prompt: '写桂林文案' }, owner, type: 'copy' });

    expect(result).toMatchObject({
      status: 'succeeded',
      usage: {
        cost: 0.0123,
        totalInputTokens: 12,
        totalOutputTokens: 8,
        totalTokens: 20,
      },
    });
    expect(update).toHaveBeenNthCalledWith(1, 'task-1', { status: 'running' });
    expect(update).toHaveBeenNthCalledWith(
      2,
      'task-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('uses expected-state transitions so a terminal task cannot move backwards', async () => {
    const transition = vi.fn(async () => true);
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => ({ artifacts: [{ content: '九寨沟旅游文案', type: 'text' }] }),
          type: 'copy',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-state-machine' }),
        transition,
        update: vi.fn(),
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '写九寨沟文案' }, owner, type: 'copy' }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(transition).toHaveBeenNthCalledWith(1, 'task-state-machine', ['queued'], {
      status: 'running',
    });
    expect(transition).toHaveBeenNthCalledWith(
      2,
      'task-state-machine',
      ['running'],
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('does not execute an adapter when another worker already claimed the queued task', async () => {
    const execute = vi.fn(async () => ({
      artifacts: [{ content: '不应生成', type: 'text' as const }],
    }));
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [{ execute, type: 'copy' }],
      repository: {
        create: async (record) => ({ ...record, id: 'task-already-claimed' }),
        transition: vi.fn(async () => false),
        update: vi.fn(),
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '重试' }, owner, type: 'copy' }),
    ).rejects.toThrow('could not be claimed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns an existing idempotent task without claiming it or executing the provider', async () => {
    const execute = vi.fn(async () => ({
      artifacts: [{ content: '不应再次生成', type: 'text' as const }],
    }));
    const transition = vi.fn(async () => true);
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [{ execute, type: 'copy' }],
      repository: {
        create: async (record) => ({
          ...record,
          artifacts: [{ content: '第一次生成的结果', type: 'text' }],
          created: false,
          id: 'task-created-by-other-process',
          status: 'succeeded',
        }),
        transition,
        update: vi.fn(),
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '同一请求' }, owner, type: 'copy' }),
    ).resolves.toMatchObject({
      artifacts: [{ content: '第一次生成的结果', type: 'text' }],
      id: 'task-created-by-other-process',
      status: 'succeeded',
    });
    expect(execute).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it.each<TravelGenerationStatus>([
    'queued',
    'running',
    'pending',
    'succeeded',
    'failed',
    'unavailable',
  ])(
    'replays an existing %s task without any state transition or provider execution',
    async (status) => {
      const execute = vi.fn(async () => ({
        artifacts: [{ content: '不应再次生成', type: 'text' as const }],
      }));
      const transition = vi.fn(async () => true);
      const orchestrator = new TravelGenerationOrchestrator({
        adapters: [{ execute, type: 'copy' }],
        repository: {
          create: async (record) => ({
            ...record,
            created: false,
            id: `existing-${status}`,
            status,
          }),
          transition,
          update: vi.fn(),
        },
      });

      await expect(
        orchestrator.run({ input: { prompt: '重放同一请求' }, owner, type: 'copy' }),
      ).resolves.toMatchObject({ id: `existing-${status}`, status });
      expect(execute).not.toHaveBeenCalled();
      expect(transition).not.toHaveBeenCalled();
    },
  );

  it('marks terminal persistence failure after provider execution as non-replayable', async () => {
    const transition = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('terminal task persistence failed'));
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => ({ artifacts: [{ content: '已由 provider 生成', type: 'text' }] }),
          type: 'copy',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-terminal-write-failed' }),
        transition,
        update: vi.fn(),
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '生成文案' }, owner, type: 'copy' }),
    ).rejects.toBeInstanceOf(TravelGenerationNonReplayableError);
  });

  it('treats a rejected terminal state transition after provider execution as non-replayable', async () => {
    const transition = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => ({ artifacts: [{ content: '已由 provider 生成', type: 'text' }] }),
          type: 'copy',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-terminal-cas-rejected' }),
        transition,
        update: vi.fn(),
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '生成文案' }, owner, type: 'copy' }),
    ).rejects.toBeInstanceOf(TravelGenerationNonReplayableError);
  });

  it('persists a safe terminal state when artifact storage fails after paid generation', async () => {
    const transition = vi.fn(async () => true);
    const interruption = new TravelGenerationArtifactPersistenceError(
      new Error('private path /secret/document and database id 123'),
    );
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => {
            throw interruption;
          },
          type: 'document',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-post-settlement-interrupted' }),
        transition,
        update: vi.fn(),
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '生成文档' }, owner, type: 'document' }),
    ).resolves.toMatchObject({
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(transition).toHaveBeenNthCalledWith(1, 'task-post-settlement-interrupted', ['queued'], {
      status: 'running',
    });
    expect(transition).toHaveBeenNthCalledWith(2, 'task-post-settlement-interrupted', ['running'], {
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(JSON.stringify(transition.mock.calls)).not.toMatch(
      /secret|private path|database id|123/,
    );
  });

  it('persists pending async task links for later owner-scoped reconciliation', async () => {
    const update = vi.fn(async () => undefined);
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => ({
            artifacts: [{ asyncTaskId: 'async-1', generationId: 'generation-1', type: 'task' }],
            status: 'pending',
          }),
          type: 'video',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-2' }),
        update,
      },
    });

    await expect(
      orchestrator.run({ input: { prompt: '生成旅游视频' }, owner, type: 'video' }),
    ).resolves.toMatchObject({ status: 'pending' });
    expect(update).toHaveBeenLastCalledWith(
      'task-2',
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('returns unavailable when no matching adapter exists', async () => {
    const update = vi.fn(async () => undefined);
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [],
      repository: { create: async (record) => ({ ...record, id: 'task-3' }), update },
    });
    await expect(
      orchestrator.run({ input: { prompt: '生成宣传片' }, owner, type: 'video' }),
    ).resolves.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE', status: 'unavailable' });
  });

  it('persists a bounded failure when a provider throws or returns no artifacts', async () => {
    for (const execute of [
      async () => {
        throw new Error('secret provider timeout');
      },
      async () => ({ artifacts: [] }),
    ]) {
      const orchestrator = new TravelGenerationOrchestrator({
        adapters: [{ execute, type: 'image' }],
        repository: {
          create: async (record) => ({ ...record, id: 'task-4' }),
          update: vi.fn(async () => undefined),
        },
      });
      const result = await orchestrator.run({
        input: { prompt: '生成封面' },
        owner,
        type: 'image',
      });
      expect(result).toMatchObject({ code: 'GENERATION_FAILED', status: 'failed' });
      expect(result.message).not.toContain('secret');
    }
  });

  it('does not log provider prompts, raw responses, or signed URLs on failure', async () => {
    debugLog.mockClear();
    const orchestrator = new TravelGenerationOrchestrator({
      adapters: [
        {
          execute: async () => {
            throw new Error(
              'private prompt; raw response; https://provider.test/image?signature=secret',
            );
          },
          type: 'image',
        },
      ],
      repository: {
        create: async (record) => ({ ...record, id: 'task-private-log' }),
        update: vi.fn(async () => undefined),
      },
    });

    await orchestrator.run({ input: { prompt: 'private prompt' }, owner, type: 'image' });

    const logged = debugLog.mock.calls.flat().map(String).join(' ');
    expect(logged).not.toMatch(
      /private prompt|raw response|provider\.test|signature=secret|task-private-log|group-1|user-1|workspace-1/,
    );
  });
});
