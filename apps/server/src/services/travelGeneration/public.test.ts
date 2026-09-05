import { describe, expect, it } from 'vitest';

import type { TravelGenerationRecord } from './index';
import { toPublicTravelGenerationTask } from './public';

const task = (overrides: Partial<TravelGenerationRecord>): TravelGenerationRecord => ({
  id: 'travel-task-1',
  input: { prompt: '不应对外的内部提示词' },
  owner: { groupId: 'group-1', userId: 'user-1' },
  provider: 'internal-provider',
  status: 'succeeded',
  type: 'copy',
  ...overrides,
});

describe('toPublicTravelGenerationTask', () => {
  it('keeps customer copy output while hiding internal execution and ownership fields', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [
          {
            content: '西藏旅游文案',
            documentId: 'internal-document',
            fileId: 'internal-file',
            mimeType: 'text/html',
            name: '<script>alert(1)</script>',
            type: 'text',
            url: 'https://temporary.provider.test/result?token=secret',
          },
        ],
      }),
    );

    expect(result).toEqual({
      artifacts: [{ content: '西藏旅游文案', type: 'text' }],
      code: undefined,
      id: 'travel-task-1',
      status: 'succeeded',
      type: 'copy',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /internal-provider|owner|prompt|internal-document|internal-file|text\/html|script|temporary\.provider|secret/,
    );
  });

  it('publishes a document only through a safe same-origin page identifier', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [
          {
            content: '<script>alert(1)</script>',
            documentId: 'document-1',
            mimeType: 'text/html',
            name: '内部文件名',
            type: 'document',
            url: 'https://temporary.provider.test/document?token=secret',
          },
        ],
        type: 'document',
      }),
    );

    expect(result.artifacts).toEqual([
      {
        documentId: 'document-1',
        id: 'document-1',
        type: 'document',
        url: '/lobehub/page/document-1',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /script|text\/html|内部文件名|temporary\.provider|secret/,
    );
  });

  it('rejects a document identifier that could escape the controlled page route', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [{ documentId: '../private?token=secret', type: 'document' }],
        type: 'document',
      }),
    );

    expect(result.artifacts).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
  });

  it('never exposes internal async task links to the customer', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [
          { asyncTaskId: 'async-secret', generationId: 'generation-secret', type: 'task' },
        ],
        status: 'pending',
        type: 'image',
      }),
    );

    expect(result.artifacts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('async-secret');
  });

  it('never exposes usage details or internal provider errors', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [{ content: '已生成文案', type: 'text' }],
        message: 'provider request failed: secret-key',
        usage: { cost: 0.0123, totalInputTokens: 12, totalOutputTokens: 8, totalTokens: 20 },
      }),
    );

    expect(result).not.toHaveProperty('usage');
    expect(result).not.toHaveProperty('message');
    expect(JSON.stringify(result)).not.toMatch(/secret-key|cost|totalTokens/);
  });

  it('never exposes durable idempotency metadata', () => {
    const result = toPublicTravelGenerationTask({
      ...task({ artifacts: [{ content: '已生成文案', type: 'text' }] }),
      idempotencyKey: 'server-only-idempotency-key',
      orderId: '00000000-0000-4000-8000-000000000009',
      requestHash: 'server-only-request-hash',
    } as TravelGenerationRecord);

    expect(JSON.stringify(result)).not.toMatch(/idempotency|orderId|requestHash|server-only/);
  });

  it('whitelists public artifact fields instead of exposing artifact cost or provider', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [
          {
            content: '已生成文案',
            cost: 99,
            provider: 'secret-provider',
            type: 'text',
          } as any,
        ],
      }),
    );

    expect(result.artifacts).toEqual([
      expect.objectContaining({ content: '已生成文案', type: 'text' }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret-provider|"cost"/);
  });

  it('publishes one authenticated owner-scoped image route without the storage path', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [
          {
            generationId: 'same-origin',
            type: 'image',
            url: '/f/image-1?X-Amz-Signature=secret-signature',
          },
        ],
        owner: { groupId: 'group-1', userId: 'user-1', workspaceId: 'workspace-1' },
        type: 'image',
      }),
    );

    expect(result.artifacts).toEqual([
      {
        id: 'same-origin',
        type: 'image',
        url: '/api/travel-generation/artifacts/travel-task-1/same-origin?workspaceId=workspace-1',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/\/f\/|secret-signature|internal-provider/);
  });

  it('publishes every safe image through an authenticated owner-scoped route', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [
          {
            generationId: 'generation-safe',
            type: 'image',
            url: '/f/image-safe?token=secret#preview',
          },
          {
            generationId: 'generation-duplicate-url',
            type: 'image',
            url: '/f/image-safe?other=secret',
          },
          {
            generationId: 'generation-platform',
            type: 'image',
            url: '/lobehub/resources/image-platform#secret',
          },
          { generationId: 'generation-data', type: 'image', url: 'data:image/png;base64,secret' },
          { generationId: 'generation-js', type: 'image', url: 'javascript:alert(1)' },
          { generationId: 'generation-file', type: 'image', url: 'file:///private/image.png' },
          {
            generationId: 'generation-external',
            type: 'image',
            url: 'https://temporary.provider.test/image?signature=secret',
          },
          { generationId: 'generation-control', type: 'image', url: '/f/image%0Asecret' },
          { generationId: '../malformed?id', type: 'image', url: '/f/malformed' },
        ],
        type: 'image',
      }),
    );

    expect(result.artifacts).toEqual([
      {
        id: 'generation-safe',
        type: 'image',
        url: '/api/travel-generation/artifacts/travel-task-1/generation-safe',
      },
      {
        id: 'generation-duplicate-url',
        type: 'image',
        url: '/api/travel-generation/artifacts/travel-task-1/generation-duplicate-url',
      },
      {
        id: 'generation-platform',
        type: 'image',
        url: '/api/travel-generation/artifacts/travel-task-1/generation-platform',
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /secret|temporary\.provider|javascript:|file:|data:|malformed/,
    );
  });

  it('never publishes artifacts from a failed image task', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [{ generationId: 'generation-failed', type: 'image', url: '/f/failed' }],
        code: 'GENERATION_FAILED',
        status: 'failed',
        type: 'image',
      }),
    );

    expect(result.artifacts).toEqual([]);
  });

  it('publishes only the bounded recovery message for paid content whose artifact save failed', () => {
    const result = toPublicTravelGenerationTask(
      task({
        code: 'ARTIFACT_PERSISTENCE_FAILED',
        message: 'private database error at /secret/path id=123',
        status: 'failed',
        type: 'document',
      }),
    );

    expect(result).toMatchObject({
      artifacts: [],
      code: 'ARTIFACT_PERSISTENCE_FAILED',
      message: '内容已生成并计费，但作品保存失败。请稍后重试查询或联系人工处理。',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toMatch(/private|database|secret|path|123/);
  });

  it('never publishes a video artifact while video settlement is unavailable', () => {
    const result = toPublicTravelGenerationTask(
      task({
        artifacts: [{ generationId: 'video-1', type: 'video', url: '/f/video-file-1' }],
        code: 'CAPABILITY_UNAVAILABLE',
        status: 'unavailable',
        type: 'video',
      }),
    );

    expect(result.artifacts).toEqual([]);
  });
});
