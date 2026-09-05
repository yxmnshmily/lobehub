import { describe, expect, it } from 'vitest';

import {
  buildCustomerCenterData,
  buildCustomerCenterPageData,
  buildCustomerGenerationDetail,
  buildCustomerGenerationFilterInput,
  buildOwnedDocumentHref,
  buildOwnedGenerationHref,
  mergeCustomerCenterPageItems,
  resolveCustomerGenerationDetailId,
} from './customerCenterAdapter';

const metrics = (input: number | null, output: number | null, cost: number | null) => ({
  costUsd: { available: cost !== null, value: cost },
  totalInputTokens: { available: input !== null, value: input },
  totalOutputTokens: { available: output !== null, value: output },
  totalTokens: {
    available: input !== null && output !== null,
    value: input !== null && output !== null ? input + output : null,
  },
});

describe('customer center adapter', () => {
  it('converts date-only filters to inclusive bounded UTC instants', () => {
    expect(
      buildCustomerGenerationFilterInput({
        dateFrom: '2026-09-01',
        dateTo: '2026-09-03',
        status: 'processing',
        type: 'image',
      }),
    ).toEqual({
      dateFrom: '2026-08-31T16:00:00.000Z',
      dateTo: '2026-09-03T15:59:59.999Z',
      status: 'processing',
      type: 'image',
    });
  });

  it('maps a safe generation detail without reviving unavailable video artifacts', () => {
    const image = buildCustomerGenerationDetail({
      artifacts: [
        { id: 'image-safe', type: 'image', url: '/f/image-safe.png' },
        { documentId: 'document-safe', id: 'document-safe', name: '行程文稿', type: 'document' },
      ],
      code: undefined,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'generation-image',
      settlementStatus: 'settled',
      status: 'succeeded',
      type: 'image',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    } as never);

    expect(image.data).toEqual({
      artifacts: [
        { id: 'image-safe', type: 'image', url: '/f/image-safe.png' },
        {
          href: '/page/document-safe',
          id: 'document-safe',
          name: '行程文稿',
          type: 'document',
        },
      ],
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'generation-image',
      isVideoUnavailable: false,
      settlementStatus: 'settled',
      status: 'succeeded',
      type: 'image',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    });

    const video = buildCustomerGenerationDetail({
      artifacts: [{ id: 'fake-video', type: 'video', url: '/f/fake.mp4' }],
      code: 'CAPABILITY_UNAVAILABLE',
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'generation-video',
      settlementStatus: 'not_applicable',
      status: 'unavailable',
      type: 'video',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    } as never);
    expect(video.data).toEqual(
      expect.objectContaining({ artifacts: [], isVideoUnavailable: true, status: 'unavailable' }),
    );
  });

  it('keeps generation detail loading and error local to the detail panel', () => {
    expect(buildCustomerGenerationDetail(undefined, { isLoading: true })).toEqual({
      isLoading: true,
    });
    expect(buildCustomerGenerationDetail(undefined, { error: '详情暂时无法读取' })).toEqual({
      error: '详情暂时无法读取',
    });
  });

  it('does not revive artifact links while Credits settlement is pending', () => {
    const detail = buildCustomerGenerationDetail({
      artifacts: [{ id: 'must-stay-hidden', type: 'image', url: '/f/unsettled.png' }],
      code: undefined,
      createdAt: new Date('2026-09-03T08:00:00.000Z'),
      id: 'unsettled-generation',
      settlementStatus: 'pending',
      status: 'succeeded',
      type: 'image',
      updatedAt: new Date('2026-09-03T09:00:00.000Z'),
    } as never);

    expect(detail.data).toMatchObject({
      artifacts: [],
      id: 'unsettled-generation',
      settlementStatus: 'pending',
    });
  });

  it('maps bounded current pages without letting ledger state cover creations', () => {
    const pageData = buildCustomerCenterPageData(
      {
        generation: {
          items: [
            {
              createdAt: new Date('2026-09-03T08:00:00.000Z'),
              id: 'generation-1',
              status: 'queued',
              title: null,
              type: 'image',
              updatedAt: new Date('2026-09-03T09:00:00.000Z'),
            },
          ],
          kind: 'generation',
          nextCursor: null,
        },
        ledger: undefined,
        work: {
          items: [
            {
              createdAt: new Date('2026-09-03T07:00:00.000Z'),
              fileType: 'text/markdown',
              id: 'document-1',
              parentId: null,
              source: 'document',
              title: '旅游文稿',
              totalCharCount: 20,
              totalLineCount: 2,
              updatedAt: new Date('2026-09-03T08:00:00.000Z'),
            },
          ],
          kind: 'work',
          nextCursor: null,
        },
      } as never,
      { ledger: { isLoading: true } },
    );

    expect(pageData.recharges).toEqual({ isLoading: true });
    expect(pageData.creations.data?.generationTasks).toEqual([
      expect.objectContaining({
        createdAt: new Date('2026-09-03T08:00:00.000Z'),
        id: 'generation-1',
        status: 'processing',
      }),
    ]);
    expect(pageData.creations.data?.works).toEqual([
      expect.objectContaining({ href: '/page/document-1', id: 'document-1' }),
    ]);
  });

  it('maps native image and video generations only to their owned topic routes', () => {
    const pageData = buildCustomerCenterPageData({
      generation: { items: [], kind: 'generation', nextCursor: null },
      ledger: { items: [], kind: 'ledger', nextCursor: null },
      work: {
        items: [
          {
            id: 'native-image',
            source: 'generation',
            title: '西藏封面',
            topicId: 'image topic/&',
            type: 'image',
            updatedAt: new Date('2026-09-03T10:00:00.000Z'),
          },
          {
            id: 'native-video',
            source: 'generation',
            title: '西藏视频',
            topicId: 'video-topic',
            type: 'video',
            updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          },
        ],
        kind: 'work',
        nextCursor: null,
      },
    } as never);

    expect(pageData.creations.data?.works).toEqual([
      {
        href: '/image?topic=image%20topic%2F%26',
        id: 'native-image',
        title: '西藏封面',
        type: 'image',
        updatedAt: new Date('2026-09-03T10:00:00.000Z'),
      },
      {
        href: '/video?topic=video-topic',
        id: 'native-video',
        title: '西藏视频',
        type: 'video',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
      },
    ]);
    expect(buildOwnedGenerationHref('copy', 'topic')).toBeUndefined();
    expect(buildOwnedGenerationHref('image', '')).toBeUndefined();
  });

  it('keeps a creations failure local to creations while an empty ledger stays usable', () => {
    const pageData = buildCustomerCenterPageData(
      {
        generation: undefined,
        ledger: { items: [], kind: 'ledger', nextCursor: null },
        work: undefined,
      } as never,
      { generation: { error: '生成记录暂时无法读取' } },
    );

    expect(pageData.recharges).toEqual({ data: [] });
    expect(pageData.creations).toEqual({ error: '生成记录暂时无法读取' });
  });

  it('maps the signed-in customer service-order page without internal fields', () => {
    const pageData = buildCustomerCenterPageData({
      generation: { items: [], kind: 'generation', nextCursor: null },
      ledger: { items: [], kind: 'ledger', nextCursor: null },
      order: {
        items: [
          {
            amountFen: 128_800,
            createdAt: new Date('2026-09-03T08:00:00.000Z'),
            id: 'order-1',
            status: 'completed',
            title: '九寨沟私家团',
            updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          },
        ],
        kind: 'order',
        nextCursor: null,
      },
      work: { items: [], kind: 'work', nextCursor: null },
    } as never);

    expect((pageData as any).orders).toEqual({
      data: [
        {
          amountFen: 128_800,
          id: 'order-1',
          occurredAt: new Date('2026-09-03T08:00:00.000Z'),
          status: 'completed',
          title: '九寨沟私家团',
        },
      ],
    });
  });

  it('merges repeated pages into one stable updatedAt + id list', () => {
    const merged = mergeCustomerCenterPageItems([
      [
        { id: 'b', updatedAt: new Date('2026-09-03T09:00:00.000Z') },
        { id: 'a', updatedAt: new Date('2026-09-03T09:00:00.000Z') },
      ],
      [
        { id: 'a', updatedAt: new Date('2026-09-03T07:00:00.000Z') },
        { id: 'z', updatedAt: new Date('2026-09-03T08:00:00.000Z') },
      ],
      [],
    ]);

    expect(merged.map(({ id }) => id)).toEqual(['b', 'a', 'z']);
    expect(merged[1].updatedAt).toEqual(new Date('2026-09-03T09:00:00.000Z'));
  });

  it('maps only the signed-in user projection without inventing unknown Token values', () => {
    const data = buildCustomerCenterData({
      content: {
        creations: {
          generation: { statusCounts: [], total: 0 },
          recentDocuments: [
            {
              createdAt: new Date('2026-09-02T00:00:00.000Z'),
              fileType: 'text/markdown',
              id: 'document-1',
              parentId: null,
              title: '西藏旅游文案',
              totalCharCount: 100,
              totalLineCount: 8,
              updatedAt: new Date('2026-09-02T01:00:00.000Z'),
            },
          ],
          recentGenerationTasks: [
            {
              createdAt: new Date('2026-09-02T00:30:00.000Z'),
              id: 'generation-1',
              status: 'running',
              title: null,
              type: 'image',
              updatedAt: new Date('2026-09-02T01:30:00.000Z'),
            },
          ],
          recentWorks: [],
        },
        privateGroup: {
          expectedMemberCount: 5,
          id: 'group-1',
          memberCount: 5,
          readiness: 'ready',
          ready: true,
          supervisorCount: 1,
          title: '旅游服务超级群组',
          updatedAt: new Date('2026-09-02T01:00:00.000Z'),
        },
      },
      credits: {
        account: {
          balanceCredits: 999_750,
          updatedAt: new Date('2026-09-02T01:00:00.000Z'),
        },
        entries: [
          {
            amountCredits: -250,
            balanceAfterCredits: 999_750,
            costUsd: 0.00025,
            createdAt: new Date('2026-09-02T01:00:00.000Z'),
            generationId: 'generation-1',
            generationType: 'agent-runtime-text-step',
            id: 'usage-1',
            model: 'deepseek-chat',
            provider: 'deepseek',
            reason: '模型用量扣费',
            reversalOfEntryId: null,
            type: 'usage_charge',
            updatedAt: new Date('2026-09-02T01:00:00.000Z'),
          },
          {
            amountCredits: 1_000_000,
            balanceAfterCredits: 1_000_000,
            costUsd: null,
            createdAt: new Date('2026-09-02T00:00:00.000Z'),
            generationId: null,
            generationType: null,
            id: 'top-up-1',
            model: null,
            provider: null,
            reason: '充值到账',
            reversalOfEntryId: null,
            type: 'top_up',
            updatedAt: new Date('2026-09-02T00:00:00.000Z'),
          },
        ],
      },
      usage: {
        byGenerationType: [],
        byProviderModel: [
          {
            countedInCanonicalTotals: true,
            metrics: metrics(200, 50, 0.00025),
            model: { available: true, value: 'deepseek-chat' },
            provider: { available: true, value: 'deepseek' },
            recordCount: 1,
            source: 'message',
          },
          {
            countedInCanonicalTotals: false,
            metrics: metrics(200, 50, 0.00025),
            model: { available: true, value: 'deepseek-chat' },
            provider: { available: true, value: 'deepseek' },
            recordCount: 1,
            source: 'agent_operation',
          },
        ],
        canonicalTotals: metrics(200, 50, 0.00025),
        operationReportedTotals: metrics(200, 50, 0.00025),
        recent: [],
      },
    } as never);

    expect(data.balances.data).toEqual({ creditBalance: 999_750 });
    expect(data.recharges.data).toEqual([
      expect.objectContaining({ creditDelta: -250, id: 'usage-1', kind: 'usage_charge' }),
      expect.objectContaining({ creditDelta: 1_000_000, id: 'top-up-1', kind: 'top_up' }),
    ]);
    expect(data.usage.data).toEqual({
      costUsd: 0.00025,
      inputTokens: 200,
      outputTokens: 50,
      totalTokens: 250,
    });
    expect(data.creations.data?.works).toEqual([
      expect.objectContaining({ href: '/page/document-1', id: 'document-1' }),
    ]);
    expect(data.creations.data?.generationTasks).toEqual([
      expect.objectContaining({
        id: 'generation-1',
        status: 'processing',
        title: null,
        type: 'image',
      }),
    ]);
    expect(data).not.toHaveProperty('group');
  });

  it('keeps unavailable metrics undefined and maps query loading/error states', () => {
    const loading = buildCustomerCenterData(undefined, { isLoading: true });
    expect(loading.usage).toEqual({ isLoading: true });

    const failed = buildCustomerCenterData(undefined, { error: '个人中心数据暂时无法读取' });
    expect(failed.balances).toEqual({ error: '个人中心数据暂时无法读取' });
  });

  it('keeps healthy sections usable when another overview section is unavailable', () => {
    const data = buildCustomerCenterData({
      content: {
        creations: null,
        privateGroup: {
          expectedMemberCount: 5,
          id: 'group-1',
          memberCount: 5,
          readiness: 'ready',
          ready: true,
          supervisorCount: 1,
          title: '本人私人群',
          updatedAt: new Date('2026-09-02T00:00:00.000Z'),
        },
      },
      credits: {
        account: null,
        entries: [
          {
            amountCredits: 500,
            balanceAfterCredits: 500,
            createdAt: new Date('2026-09-02T00:00:00.000Z'),
            id: 'entry-1',
            type: 'top_up',
            updatedAt: new Date('2026-09-02T00:00:00.000Z'),
          },
        ],
      },
      usage: { canonicalTotals: metrics(20, 5, 0.000_025) },
    } as never);

    expect(data.balances).toEqual({ isUnavailable: true });
    expect(data.recharges.data).toEqual([
      expect.objectContaining({ creditDelta: 500, id: 'entry-1' }),
    ]);
    expect(data.usage.data).toEqual({
      costUsd: 0.000_025,
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
    });
    expect(data.creations).toEqual({ isUnavailable: true });
    expect(data).not.toHaveProperty('group');
  });

  it('only creates a single-segment href for a safe server-returned document id', () => {
    expect(buildOwnedDocumentHref('document_01-abc')).toBe('/page/document_01-abc');
    expect(buildOwnedDocumentHref('../other-user')).toBeUndefined();
    expect(buildOwnedDocumentHref('folder/document')).toBeUndefined();
    expect(buildOwnedDocumentHref('https://evil.example/work')).toBeUndefined();
    expect(buildOwnedDocumentHref('document?redirect=https://evil.example')).toBeUndefined();
  });

  it('accepts only a bounded opaque generation id from a detail deep link', () => {
    expect(resolveCustomerGenerationDetailId('generation_01-abc')).toBe('generation_01-abc');
    expect(resolveCustomerGenerationDetailId('../other-user')).toBeUndefined();
    expect(resolveCustomerGenerationDetailId('generation?targetUserId=other')).toBeUndefined();
    expect(resolveCustomerGenerationDetailId('x'.repeat(256))).toBeUndefined();
    expect(resolveCustomerGenerationDetailId(null)).toBeUndefined();
  });
});
