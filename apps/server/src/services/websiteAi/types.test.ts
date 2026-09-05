import { describe, expect, it } from 'vitest';

import { createWebsiteAiProgressTracker, normalizeWebsiteAiStreamEvent } from './types';

const event = (type: string, data: unknown) =>
  ({ data, operationId: 'op-1', stepIndex: 0, timestamp: 1, type }) as any;

describe('normalizeWebsiteAiStreamEvent', () => {
  it('maps the real runtime success reason to one public completed terminal', () => {
    expect(
      normalizeWebsiteAiStreamEvent(event('agent_runtime_end', { reason: 'done', uiMessages: [] })),
    ).toEqual([
      { status: 'completed', type: 'status' },
      { reason: 'completed', type: 'done' },
    ]);
  });

  it('does not expose model usage or routing fields in the homepage event contract', () => {
    const usage = {
      cost: 0.0012,
      inputCachedTokens: 4,
      totalInputTokens: 12,
      totalOutputTokens: 8,
      totalTokens: 20,
    };

    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            model: 'internal-model-name',
            provider: 'internal-provider',
            usage: { ...usage, apiKey: 'must-not-leak' },
          },
        ],
      }),
    );

    expect(result).toEqual([
      { status: 'completed', type: 'status' },
      { reason: 'completed', type: 'done' },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /apiKey|cost|internal-model-name|internal-provider|totalInputTokens|totalOutputTokens|totalTokens|usage/,
    );
  });

  it('exposes only visible text chunks', () => {
    expect(
      normalizeWebsiteAiStreamEvent(event('stream_chunk', { chunkType: 'text', content: '你好' })),
    ).toEqual([{ text: '你好', type: 'delta' }]);
    expect(
      normalizeWebsiteAiStreamEvent(
        event('stream_chunk', { chunkType: 'reasoning', reasoning: '内部思考' }),
      ),
    ).toEqual([]);
  });

  it('returns task completion and deduplicated artifact references', () => {
    expect(
      normalizeWebsiteAiStreamEvent(
        event('agent_runtime_end', {
          reason: 'completed',
          uiMessages: [
            {
              fileList: [{ id: 'file-1', name: '行程.pdf', url: '/files/1' }],
              works: [{ id: 'work-1', title: '桂林行程', type: 'document' }],
            },
            { fileList: [{ id: 'file-1', name: '行程.pdf', url: '/files/1' }] },
          ],
        }),
      ),
    ).toEqual([
      {
        id: 'work-1',
        kind: 'document',
        title: '桂林行程',
        type: 'artifact',
        url: '/lobehub/page/work-1',
      },
      { id: 'file-1', kind: 'file', title: '行程.pdf', type: 'artifact', url: '/f/file-1' },
      { status: 'completed', type: 'status' },
      { reason: 'completed', type: 'done' },
    ]);
  });

  it('maps document, image, video and unlinked work artifacts without duplicates', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            imageList: [{ id: 'image-1', name: '封面图' }],
            videoList: [{ id: 'video-1', name: '成片' }],
            works: [
              { id: '行程文档-1', title: '行程文档', type: 'document' },
              { id: 'work-1', title: '已创建任务', type: 'work' },
              { id: 'image-1', title: '重复封面图', type: 'image' },
              { id: '行程文档-1', title: '行程文档', type: 'document' },
            ],
          },
          {
            imageList: [{ id: 'image-1', name: '封面图' }],
            videoList: [{ id: 'video-1', name: '成片' }],
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        id: '行程文档-1',
        kind: 'document',
        title: '行程文档',
        type: 'artifact',
        url: '/lobehub/page/%E8%A1%8C%E7%A8%8B%E6%96%87%E6%A1%A3-1',
      },
      {
        id: 'work-1',
        kind: 'work',
        title: '已创建任务',
        type: 'artifact',
        url: undefined,
      },
      { id: 'image-1', kind: 'image', title: '封面图', type: 'artifact', url: '/f/image-1' },
      { id: 'video-1', kind: 'video', title: '成片', type: 'artifact', url: '/f/video-1' },
      { status: 'completed', type: 'status' },
      { reason: 'completed', type: 'done' },
    ]);
  });

  it('builds same-origin file URLs from ids regardless of stored host', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            imageList: [
              {
                id: '550e8400-e29b-41d4-a716-446655440000',
                name: '封面图',
                url: 'http://localhost:3010/files/private-image',
              },
            ],
            videoList: [
              {
                id: 'video-1',
                name: '行程视频',
                url: 'https://storage.example/video.mp4',
              },
            ],
          },
        ],
      }),
    );

    expect(result.slice(0, 2)).toEqual([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        kind: 'image',
        title: '封面图',
        type: 'artifact',
        url: '/f/550e8400-e29b-41d4-a716-446655440000',
      },
      {
        id: 'video-1',
        kind: 'video',
        title: '行程视频',
        type: 'artifact',
        url: '/f/video-1',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('localhost:3010');
    expect(JSON.stringify(result)).not.toContain('storage.example');
  });

  it('exposes only safe artifact fields from a server tool state', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            pluginState: {
              artifacts: [
                {
                  asyncTaskId: 'async-secret',
                  generationId: 'generation-secret',
                  id: 'generation-1',
                  kind: 'video',
                  provider: 'provider-secret',
                  title: '旅游视频生成任务',
                  topicId: 'topic-secret',
                },
              ],
              status: 'pending',
              taskId: 'task-secret',
            },
            role: 'tool',
          },
        ],
      }),
    );

    expect(result[0]).toEqual({
      id: 'generation-1',
      kind: 'video',
      title: '旅游视频生成任务',
      type: 'artifact',
      url: undefined,
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('exposes an owned pending generation reference for homepage polling', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            pluginState: {
              travelGeneration: {
                artifacts: [],
                id: 'travel-task-1',
                internalProvider: 'must-not-leak',
                status: 'pending',
                type: 'image',
              },
            },
            role: 'tool',
          },
        ],
      }),
    );

    expect(result[0]).toEqual({
      id: 'travel-task-1',
      kind: 'image',
      status: 'pending',
      taskId: 'travel-task-1',
      title: '旅游图片制作中',
      type: 'artifact',
      url: undefined,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('keeps only controlled public resource routes and strips URL secrets', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            works: [
              { id: 'work-relative', type: 'document', url: '/lobehub/works/relative' },
              {
                id: 'work-absolute',
                type: 'document',
                url: 'http://127.0.0.1:3010/lobehub/works/absolute?view=1',
              },
              {
                id: 'page-absolute',
                type: 'document',
                url: 'http://127.0.0.1:3010/lobehub/page/中文行程?token=secret#preview',
              },
              {
                id: 'work-external',
                type: 'document',
                url: 'https://evil.example/lobehub/page/spoofed?signature=secret',
              },
            ],
          },
        ],
      }),
      undefined,
      'http://127.0.0.1:3010',
    );

    expect(result.slice(0, 4)).toEqual([
      {
        id: 'work-relative',
        kind: 'document',
        title: undefined,
        type: 'artifact',
        url: undefined,
      },
      {
        id: 'work-absolute',
        kind: 'document',
        title: undefined,
        type: 'artifact',
        url: undefined,
      },
      {
        id: 'page-absolute',
        kind: 'document',
        title: undefined,
        type: 'artifact',
        url: '/lobehub/page/%E4%B8%AD%E6%96%87%E8%A1%8C%E7%A8%8B',
      },
      {
        id: 'work-external',
        kind: 'document',
        title: undefined,
        type: 'artifact',
        url: undefined,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/evil\.example|secret|signature|token/);
  });

  it.each([
    ['empty file id', '/f/'],
    ['file prefix confusion', '/f-evil/id'],
    ['page prefix confusion', '/lobehub/pageevil/id'],
    ['non-public LobeHub route', '/lobehub/works/id'],
    ['protocol-relative URL', '//public.example/f/id'],
    ['backslash', '/f/id\\evil'],
    ['encoded control', '/f/id%0Asecret'],
    ['encoded traversal and slash', '/f/%2e%2e%2fsecret'],
    ['double-encoded traversal and slash', '/f/%252e%252e%252fsecret'],
    ['mixed encoded traversal and backslash', '/f/%2e%2E%5csecret'],
    ['extra path segment', '/f/id/extra'],
    ['same-origin credentials', 'https://user:password@public.example/f/id'],
    ['external signed URL', 'https://provider.example/f/id?token=secret'],
    ['javascript URL', 'javascript:alert(1)'],
    ['data URL', 'data:text/plain,secret'],
    ['file URL', 'file:///private/secret'],
  ])('rejects a %s artifact URL', (_label, url) => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            pluginState: {
              artifacts: [{ id: 'artifact-1', kind: 'image', url }],
            },
          },
        ],
      }),
      undefined,
      'https://public.example',
    );

    expect(result[0]).toEqual({
      id: 'artifact-1',
      kind: 'image',
      title: undefined,
      type: 'artifact',
      url: undefined,
    });
  });

  it.each([
    [
      'UUID file id',
      '/f/550e8400-e29b-41d4-a716-446655440000?X-Amz-Signature=secret#preview',
      '/f/550e8400-e29b-41d4-a716-446655440000',
    ],
    [
      'Chinese page id',
      '/lobehub/page/中文行程?token=secret#preview',
      '/lobehub/page/%E4%B8%AD%E6%96%87%E8%A1%8C%E7%A8%8B',
    ],
    [
      'same-origin public resource id',
      'https://public.example/lobehub/resources/resource-1?signature=secret',
      '/lobehub/resources/resource-1',
    ],
  ])('normalizes a safe %s without query or hash', (_label, url, expectedUrl) => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            pluginState: {
              artifacts: [{ id: 'artifact-1', kind: 'image', url }],
            },
          },
        ],
      }),
      undefined,
      'https://public.example',
    );

    expect(result[0]).toMatchObject({ type: 'artifact', url: expectedUrl });
    expect(JSON.stringify(result[0])).not.toMatch(/secret|signature|token/);
  });

  it('does not build public links from unsafe message artifact ids', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'completed',
        uiMessages: [
          {
            imageList: [{ id: 'image/cover 1', name: '非安全图片' }],
            works: [
              { id: '../private', title: '非安全文档', type: 'document' },
              { id: '中文行程', title: '合法文档', type: 'document' },
            ],
          },
        ],
      }),
    );

    expect(result.slice(0, 3)).toEqual([
      {
        id: '../private',
        kind: 'document',
        title: '非安全文档',
        type: 'artifact',
        url: undefined,
      },
      {
        id: '中文行程',
        kind: 'document',
        title: '合法文档',
        type: 'artifact',
        url: '/lobehub/page/%E4%B8%AD%E6%96%87%E8%A1%8C%E7%A8%8B',
      },
      {
        id: 'image/cover 1',
        kind: 'image',
        title: '非安全图片',
        type: 'artifact',
        url: undefined,
      },
    ]);
  });

  it('returns a stable public error instead of runtime state', () => {
    expect(
      normalizeWebsiteAiStreamEvent(
        event('agent_runtime_end', { reason: 'error', reasonDetail: 'provider unavailable' }),
      ),
    ).toEqual([
      { code: 'AGENT_ERROR', message: '本次 AI 任务未完成，请稍后重试。', type: 'error' },
      { reason: 'error', type: 'done' },
    ]);
  });

  it('does not expose an unknown internal terminal reason', () => {
    const result = normalizeWebsiteAiStreamEvent(
      event('agent_runtime_end', {
        reason: 'private-provider/model-key lookup failed',
        reasonDetail: 'private internal prompt',
      }),
    );

    expect(result).toEqual([
      { code: 'AGENT_ERROR', message: '本次 AI 任务未完成，请稍后重试。', type: 'error' },
      { reason: 'error', type: 'done' },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private-provider|model-key|internal prompt/);
  });

  it('reports a member start and completion using only its public name', () => {
    const progress = createWebsiteAiProgressTracker([{ id: 'agt-copy', name: '旅游文案助理' }]);

    const started = normalizeWebsiteAiStreamEvent(
      event('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'speak',
            arguments: JSON.stringify({ agentId: 'agt-copy', instruction: '内部提示词' }),
            id: 'call-copy',
            identifier: 'lobe-group-management',
            type: 'default',
          },
        ],
      }),
      progress,
    );
    const completed = normalizeWebsiteAiStreamEvent(
      event('step_start', {
        uiMessages: [
          {
            plugin: {
              apiName: 'speak',
              arguments: JSON.stringify({ agentId: 'agt-copy', instruction: '内部提示词' }),
              identifier: 'lobe-group-management',
            },
            pluginState: { status: 'completed' },
            role: 'tool',
          },
        ],
      }),
      progress,
    );

    expect(started).toEqual([
      {
        member: '旅游文案助理',
        message: '旅游文案助理正在执行……',
        phase: 'started',
        status: 'member_progress',
        type: 'status',
      },
    ]);
    expect(completed).toEqual([
      {
        member: '旅游文案助理',
        message: '旅游文案助理已完成。',
        phase: 'completed',
        status: 'member_progress',
        type: 'status',
      },
    ]);
    expect(JSON.stringify([...started, ...completed])).not.toContain('agt-copy');
    expect(JSON.stringify([...started, ...completed])).not.toContain('内部提示词');
  });

  it('keeps mixed-intent member progress in dispatch order', () => {
    const progress = createWebsiteAiProgressTracker([
      { id: 'agt-copy', name: '旅游文案助理' },
      { id: 'agt-image', name: '图片封面助理' },
    ]);
    const tool = (agentId: string, callId: string) =>
      event('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'speak',
            arguments: JSON.stringify({ agentId, instruction: 'hidden' }),
            id: callId,
            identifier: 'lobe-group-management',
            type: 'default',
          },
        ],
      });
    const settled = (agentId: string) =>
      event('step_start', {
        uiMessages: [
          {
            plugin: {
              apiName: 'speak',
              arguments: JSON.stringify({ agentId, instruction: 'hidden' }),
              identifier: 'lobe-group-management',
            },
            pluginState: { status: 'completed' },
            role: 'tool',
          },
        ],
      });

    const emitted = [
      ...normalizeWebsiteAiStreamEvent(tool('agt-copy', 'call-copy'), progress),
      ...normalizeWebsiteAiStreamEvent(settled('agt-copy'), progress),
      ...normalizeWebsiteAiStreamEvent(tool('agt-image', 'call-image'), progress),
      ...normalizeWebsiteAiStreamEvent(settled('agt-image'), progress),
    ].filter(
      (
        item,
      ): item is Extract<
        ReturnType<typeof normalizeWebsiteAiStreamEvent>[number],
        { type: 'status' }
      > & { member: string; phase: 'completed' | 'failed' | 'started' } =>
        item.type === 'status' &&
        item.status === 'member_progress' &&
        !!item.member &&
        !!item.phase,
    );

    expect(emitted.map(({ member, phase }) => [member, phase])).toEqual([
      ['旅游文案助理', 'started'],
      ['旅游文案助理', 'completed'],
      ['图片封面助理', 'started'],
      ['图片封面助理', 'completed'],
    ]);
  });

  it('reports a safe failed phase when member startup falls back to the supervisor', () => {
    const progress = createWebsiteAiProgressTracker([{ id: 'agt-image', name: '图片封面助理' }]);
    normalizeWebsiteAiStreamEvent(
      event('stream_chunk', {
        chunkType: 'tools_calling',
        toolsCalling: [
          {
            apiName: 'speak',
            arguments: JSON.stringify({ agentId: 'agt-image', instruction: 'hidden' }),
            id: 'call-image',
            identifier: 'lobe-group-management',
            type: 'default',
          },
        ],
      }),
      progress,
    );

    const failed = normalizeWebsiteAiStreamEvent(
      event('step_start', {
        uiMessages: [
          {
            plugin: {
              apiName: 'speak',
              arguments: JSON.stringify({ agentId: 'agt-image', instruction: 'hidden' }),
              identifier: 'lobe-group-management',
            },
            pluginError: { code: 'AGENT_MEMBER_START_FAILED', message: 'internal details' },
            pluginState: { status: 'error' },
            role: 'tool',
          },
        ],
      }),
      progress,
    );

    expect(failed[0]).toEqual({
      member: '图片封面助理',
      message: '图片封面助理未完成，已交由群主 AI 继续处理。',
      phase: 'failed',
      status: 'member_progress',
      type: 'status',
    });
    expect(JSON.stringify(failed)).not.toContain('internal details');
  });
});
