// @vitest-environment node
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCustomerCenterPage,
  buildCustomerGenerationPage,
  buildCustomerWorkPage,
  customerCenterRouter,
  decodeCustomerCenterCursor,
  encodeCustomerCenterCursor,
  projectCustomerGenerationDetail,
} from '../customerCenter';

const mocks = vi.hoisted(() => ({
  contentGetOverview: vi.fn(),
  contentModelConstructor: vi.fn(),
  creditGetAccount: vi.fn(),
  creditListEntries: vi.fn(),
  creditModelConstructor: vi.fn(),
  pageLimits: vi.fn(),
  pageRows: [] as unknown[][],
  pageTotal: 0,
  pageWhere: vi.fn(),
  usageGetUsage: vi.fn(),
  usageModelConstructor: vi.fn(),
}));

vi.mock('@/database/models/platformCredit', () => ({
  PlatformCreditModel: class {
    constructor(db: unknown, userId: string) {
      mocks.creditModelConstructor(db, userId);
    }

    getAccount = mocks.creditGetAccount;
    getAccountWithAvailability = mocks.creditGetAccount;
    listEntries = mocks.creditListEntries;
  },
}));

vi.mock('@/database/models/platformUserContent', () => ({
  PlatformUserContentModel: class {
    constructor(db: unknown) {
      mocks.contentModelConstructor(db);
    }

    getOverview = mocks.contentGetOverview;
  },
}));

vi.mock('@/database/models/platformUserUsage', () => ({
  PlatformUserUsageModel: class {
    constructor(db: unknown, userId: string) {
      mocks.usageModelConstructor(db, userId);
    }

    getUsage = mocks.usageGetUsage;
  },
}));

vi.mock('@/libs/trpc/lambda/middleware', () => ({
  serverDatabase: vi.fn((opts: any) => opts.next({ ctx: opts.ctx })),
}));

const customerId = 'customer-center-customer';
const otherUserId = 'customer-center-other-user';
const workspaceId = 'customer-center-workspace';
const serverDB = {
  marker: 'customer-center-test-db',
  select: vi.fn((fields?: { total?: unknown }) => {
    const builder = {
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      limit: vi.fn(async (limit: number) => {
        mocks.pageLimits(limit);
        return mocks.pageRows.shift() || [];
      }),
      orderBy: vi.fn(() => builder),
      where: vi.fn((condition: unknown) => {
        mocks.pageWhere(condition);
        return fields?.total ? Promise.resolve([{ total: mocks.pageTotal }]) : builder;
      }),
    };
    return builder;
  }),
};

const customerCaller = (activeWorkspaceId?: string) =>
  customerCenterRouter.createCaller({
    serverDB,
    userId: customerId,
    workspaceId: activeWorkspaceId,
  } as any);

const availableMetrics = {
  costUsd: { available: true, value: 0.000_25 },
  totalInputTokens: { available: true, value: 200 },
  totalOutputTokens: { available: true, value: 50 },
  totalTokens: { available: true, value: 250 },
};

const arrangeSafeModelResults = () => {
  mocks.creditGetAccount.mockResolvedValue({
    availableCredits: 1_750_000,
    balanceCredits: 1_750_000,
    heldCredits: 0,
    createdAt: new Date('2026-09-02T08:00:00.000Z'),
    id: 'credit-account-id-must-not-leak',
    updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    userId: customerId,
    userIdSnapshot: customerId,
  });
  mocks.creditListEntries.mockResolvedValue([
    {
      accountId: 'credit-account-id-must-not-leak',
      actorUserIdSnapshot: customerId,
      amountCredits: -250,
      balanceAfterCredits: 1_750_000,
      costUsd: 0.000_25,
      createdAt: new Date('2026-09-02T09:00:00.000Z'),
      generationId: 'generation-safe-id',
      generationType: 'copy',
      id: 'credit-entry-safe-id',
      idempotencyKey: 'IDEMPOTENCY_KEY_MUST_NOT_LEAK',
      model: 'deepseek-chat',
      operatorUserId: 'OPERATOR_USER_ID_MUST_NOT_LEAK',
      provider: 'deepseek',
      reason: '模型用量扣费',
      reversalOfEntryId: null,
      tokenUsage: { secretToolArguments: 'TOOL_ARGUMENTS_MUST_NOT_LEAK', totalTokens: 250 },
      type: 'usage_charge',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
      userId: customerId,
      userIdSnapshot: customerId,
      workspaceId: 'WORKSPACE_ID_MUST_NOT_LEAK',
    },
  ]);
  mocks.usageGetUsage.mockResolvedValue({
    byGenerationType: [
      {
        countedInCanonicalTotals: true,
        generationType: { available: true, value: 'copy' },
        metrics: availableMetrics,
        model: { available: false, value: 'unknown' },
        prompt: 'USAGE_PROMPT_MUST_NOT_LEAK',
        provider: { available: true, value: 'deepseek' },
        recordCount: 1,
        source: 'travel_generation',
      },
    ],
    byProviderModel: [
      {
        countedInCanonicalTotals: true,
        messages: ['MESSAGE_BODY_MUST_NOT_LEAK'],
        metrics: availableMetrics,
        model: { available: true, value: 'deepseek-chat' },
        provider: { available: true, value: 'deepseek' },
        recordCount: 1,
        source: 'message',
      },
    ],
    canonicalTotals: availableMetrics,
    operationReportedTotals: {
      costUsd: { available: false, value: null },
      totalInputTokens: { available: false, value: null },
      totalOutputTokens: { available: false, value: null },
      totalTokens: { available: false, value: null },
    },
    recent: [
      {
        countedInCanonicalTotals: true,
        createdAt: new Date('2026-09-02T09:00:00.000Z'),
        id: 'usage-safe-id',
        kind: { available: true, value: 'chat' },
        metrics: availableMetrics,
        model: { available: true, value: 'deepseek-chat' },
        provider: { available: true, value: 'deepseek' },
        source: 'message',
        toolParameters: 'USAGE_TOOL_PARAMETERS_MUST_NOT_LEAK',
      },
    ],
    userId: customerId,
  });
  mocks.contentGetOverview.mockResolvedValue({
    generation: {
      internalPrompt: 'GENERATION_PROMPT_MUST_NOT_LEAK',
      statusCounts: [{ count: 2, status: 'succeeded' }],
      total: 2,
    },
    recentGenerationTasks: [
      {
        artifacts: [{ url: 'GENERATION_PRIVATE_ARTIFACT_MUST_NOT_LEAK' }],
        createdAt: new Date('2026-09-02T08:45:00.000Z'),
        id: 'generation-task-safe-id',
        input: { prompt: 'GENERATION_TASK_PROMPT_MUST_NOT_LEAK' },
        message: 'GENERATION_TASK_MESSAGE_MUST_NOT_LEAK',
        provider: 'GENERATION_PROVIDER_INTERNAL_MUST_NOT_LEAK',
        status: 'succeeded',
        title: null,
        type: 'copy',
        updatedAt: new Date('2026-09-02T09:15:00.000Z'),
        usage: { apiKey: 'GENERATION_USAGE_RAW_MUST_NOT_LEAK' },
      },
    ],
    recentDocuments: [
      {
        content: 'DOCUMENT_BODY_MUST_NOT_LEAK',
        createdAt: new Date('2026-09-02T07:00:00.000Z'),
        fileType: 'text/markdown',
        id: 'document-safe-id',
        metadata: { apiKey: 'DOCUMENT_KEY_MUST_NOT_LEAK' },
        parentId: null,
        source: '/private/DOCUMENT_SOURCE_MUST_NOT_LEAK',
        title: '西藏文案',
        totalCharCount: 120,
        totalLineCount: 8,
        updatedAt: new Date('2026-09-02T08:00:00.000Z'),
      },
    ],
    recentWorks: [
      {
        createdAt: new Date('2026-09-02T07:30:00.000Z'),
        description: 'WORK_BODY_MUST_NOT_LEAK',
        id: 'work-safe-id',
        resourceType: 'document',
        status: 'completed',
        title: '西藏旅游文案',
        type: 'document',
        updatedAt: new Date('2026-09-02T08:30:00.000Z'),
        url: 'https://private.example/WORK_URL_MUST_NOT_LEAK',
      },
    ],
    travelGroup: {
      config: { systemPrompt: 'GROUP_CONFIG_MUST_NOT_LEAK' },
      expectedMemberCount: 5,
      id: 'group-safe-id',
      memberCount: 5,
      readiness: 'ready',
      ready: true,
      supervisorCount: 1,
      title: '旅游服务超级群组',
      updatedAt: new Date('2026-09-02T08:00:00.000Z'),
    },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pageRows.splice(0);
  mocks.pageTotal = 0;
  arrangeSafeModelResults();
});

describe('customer center tRPC self-service projection', () => {
  it('returns only current-user canonical usage fields without provider secrets or duplicate operations', async () => {
    const row = {
      countedInCanonicalTotals: true,
      createdAt: new Date('2026-09-05T08:00:00Z'),
      id: 'message-1',
      kind: { available: true, value: 'chat' },
      metrics: availableMetrics,
      model: { available: true, value: 'test-model' },
      provider: { available: true, value: 'private-provider' },
      source: 'message',
      prompt: 'PRIVATE_PROMPT',
    };
    mocks.usageGetUsage.mockResolvedValue({
      recent: [row, { ...row, countedInCanonicalTotals: false, source: 'agent_operation' }],
    });
    const rows = await customerCaller().getUsageDetails();
    expect(mocks.usageModelConstructor).toHaveBeenCalledWith(serverDB, customerId);
    expect(rows).toEqual([
      {
        createdAt: row.createdAt,
        id: 'message:message-1',
        inputTokens: 200,
        kind: 'chat',
        model: 'test-model',
        outputTokens: 50,
        totalTokens: 250,
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/private-provider|PRIVATE_PROMPT|costUsd/);
  });
  it('filters generation rows by customer type, normalized status and inclusive date range', () => {
    const page = buildCustomerGenerationPage(
      [
        {
          artifacts: [{ generationId: 'secret-artifact', type: 'image', url: '/f/secret.png' }],
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          id: 'image-running',
          input: { prompt: 'PRIVATE_PROMPT' },
          ip: '127.0.0.1',
          message: 'INTERNAL_ERROR',
          provider: 'PRIVATE_PROVIDER',
          status: 'running',
          type: 'image',
          updatedAt: new Date('2026-09-02T09:00:00.000Z'),
          usage: { totalTokens: 100 },
        },
        {
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          id: 'image-succeeded',
          status: 'succeeded',
          type: 'image',
          updatedAt: new Date('2026-09-02T08:00:00.000Z'),
        },
        {
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          id: 'audio-running',
          status: 'running',
          type: 'audio',
          updatedAt: new Date('2026-09-02T08:30:00.000Z'),
        },
      ],
      20,
      undefined,
      {
        dateFrom: new Date('2026-09-02T00:00:00.000Z'),
        dateTo: new Date('2026-09-02T23:59:59.999Z'),
        status: 'processing',
        type: 'image',
      },
    );

    expect(page.items).toEqual([
      {
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        id: 'image-running',
        status: 'running',
        title: '图片生成',
        type: 'image',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(
      /PRIVATE_PROMPT|PRIVATE_PROVIDER|INTERNAL_ERROR|127\.0\.0\.1|totalTokens|secret-artifact/,
    );
  });

  it('shows video only as an explicit failed or unavailable task and never as a work', () => {
    const rows = [
      {
        createdAt: new Date('2026-09-03T08:00:00.000Z'),
        id: 'video-succeeded-must-stay-hidden',
        status: 'succeeded',
        type: 'video',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-09-03T07:00:00.000Z'),
        id: 'video-unavailable',
        status: 'unavailable',
        type: 'video',
        updatedAt: new Date('2026-09-03T08:00:00.000Z'),
      },
    ];

    expect(buildCustomerGenerationPage(rows, 20).items.map(({ id }) => id)).toEqual([
      'video-unavailable',
    ]);
    expect(
      buildCustomerWorkPage(
        [
          {
            id: 'video-work-must-stay-hidden',
            resourceType: 'video',
            source: 'work',
            status: 'succeeded',
            updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          },
        ],
        20,
      ).items,
    ).toEqual([]);
  });

  it('does not expose a successful video through a guessed detail id', async () => {
    mocks.pageRows.push([
      {
        artifacts: [{ id: 'video-must-stay-hidden', type: 'video', url: '/f/video.mp4' }],
        createdAt: new Date('2026-09-03T08:00:00.000Z'),
        id: 'video-succeeded-must-stay-hidden',
        status: 'succeeded',
        type: 'video',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        workspaceId,
      },
    ]);

    await expect(
      customerCaller(workspaceId).getGenerationDetail({ id: 'video-succeeded-must-stay-hidden' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.pageLimits).toHaveBeenCalledOnce();
  });

  it('projects only controlled artifacts and makes unavailable video explicit', () => {
    const succeeded = projectCustomerGenerationDetail(
      {
        artifacts: [
          { generationId: 'image-safe', type: 'image', url: '/f/image-safe.png' },
          { generationId: 'image-evil', type: 'image', url: 'https://evil.example/image.png' },
          { asyncTaskId: 'async-secret', type: 'task' },
        ],
        code: null,
        createdAt: new Date('2026-09-02T08:00:00.000Z'),
        groupConfig: { prompt: 'GROUP_SECRET' },
        id: 'generation-image',
        input: { prompt: 'PROMPT_SECRET' },
        ip: '127.0.0.1',
        message: 'INTERNAL_MESSAGE',
        model: 'PRIVATE_MODEL',
        provider: 'PRIVATE_PROVIDER',
        status: 'succeeded',
        type: 'image',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
        usage: { raw: 'USAGE_SECRET' },
      } as never,
      { isSettled: true },
    );

    expect(succeeded).toEqual({
      artifacts: [
        {
          id: 'image-safe',
          type: 'image',
          url: '/api/travel-generation/artifacts/generation-image/image-safe',
        },
      ],
      code: undefined,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'generation-image',
      settlementStatus: 'settled',
      status: 'succeeded',
      type: 'image',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    });
    expect(JSON.stringify(succeeded)).not.toMatch(
      /evil\.example|GROUP_SECRET|PROMPT_SECRET|127\.0\.0\.1|INTERNAL_MESSAGE|PRIVATE_MODEL|PRIVATE_PROVIDER|USAGE_SECRET|async-secret/,
    );

    expect(
      projectCustomerGenerationDetail({
        artifacts: [{ generationId: 'fake-video', type: 'video', url: '/f/fake.mp4' }],
        code: 'CAPABILITY_UNAVAILABLE',
        createdAt: new Date('2026-09-02T08:00:00.000Z'),
        id: 'generation-video',
        status: 'unavailable',
        type: 'video',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
      }),
    ).toEqual({
      artifacts: [],
      code: 'CAPABILITY_UNAVAILABLE',
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'generation-video',
      settlementStatus: 'not_applicable',
      status: 'unavailable',
      type: 'video',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    });
  });

  it('does not expose an internal generation failure code', () => {
    expect(
      projectCustomerGenerationDetail({
        artifacts: [],
        code: 'PROVIDER_RATE_LIMIT_WITH_INTERNAL_CONTEXT',
        createdAt: new Date('2026-09-02T08:00:00.000Z'),
        id: 'failed-generation',
        status: 'failed',
        type: 'copy',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
      }),
    ).toEqual({
      artifacts: [],
      code: undefined,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'failed-generation',
      settlementStatus: 'not_applicable',
      status: 'failed',
      type: 'copy',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    });
  });

  it('omits deleted image artifacts while retaining the generation history', async () => {
    mocks.pageRows.push(
      [
        {
          id: 'deleted-image-task',
          type: 'image',
          status: 'succeeded',
          code: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          artifacts: [{ type: 'image', generationId: 'deleted-image' }],
        },
      ],
      [{ generationId: 'deleted-image-task', generationType: 'image' }],
      [],
    );
    const detail = await customerCaller().getGenerationDetail({ id: 'deleted-image-task' });
    expect(detail.artifacts).toEqual([]);
    expect(detail.id).toBe('deleted-image-task');
  });

  it('serves a customer-safe generation detail and hides missing records', async () => {
    mocks.pageRows.push(
      [
        {
          artifacts: [
            { generationId: 'safe-image', type: 'image', url: '/f/safe-image.png' },
            { generationId: 'unsafe-image', type: 'image', url: 'https://evil.example/image.png' },
          ],
          code: null,
          createdAt: new Date('2026-09-02T08:00:00.000Z'),
          id: 'owned-generation',
          input: { prompt: 'PRIVATE_PROMPT' },
          message: 'INTERNAL_MESSAGE',
          provider: 'PRIVATE_PROVIDER',
          status: 'succeeded',
          type: 'image',
          updatedAt: new Date('2026-09-02T09:00:00.000Z'),
          usage: { raw: 'USAGE_SECRET' },
        },
      ],
      [{ generationId: 'owned-generation', generationType: 'image', id: 'settled-credit-entry' }],
      [{ id: 'safe-image' }, { id: 'unsafe-image' }],
    );

    const detail = await (customerCaller() as any).getGenerationDetail({ id: 'owned-generation' });

    expect(detail).toEqual({
      artifacts: [
        {
          id: 'safe-image',
          type: 'image',
          url: '/api/travel-generation/artifacts/owned-generation/safe-image',
        },
      ],
      code: undefined,
      createdAt: new Date('2026-09-02T08:00:00.000Z'),
      id: 'owned-generation',
      settlementStatus: 'settled',
      status: 'succeeded',
      type: 'image',
      updatedAt: new Date('2026-09-02T09:00:00.000Z'),
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /evil\.example|PRIVATE_PROMPT|INTERNAL_MESSAGE|PRIVATE_PROVIDER|USAGE_SECRET/,
    );
    expect(mocks.pageLimits).toHaveBeenCalledWith(1);
    const detailQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[0][0]);
    expect(detailQuery.params).toEqual(expect.arrayContaining(['owned-generation', customerId]));
    expect(detailQuery.params).not.toContain(otherUserId);

    mocks.pageRows.push([]);
    await expect(
      (customerCaller() as any).getGenerationDetail({ id: 'missing-generation' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each(['copy', 'document'] as const)(
    'recognizes the canonical %s step charge while retaining the legacy task-id fallback',
    async (type) => {
      const taskId = `${type}-generation`;
      const canonicalGenerationId = `travel-generation:${taskId}:step:0:call_llm`;
      mocks.pageRows.push(
        [
          {
            artifacts:
              type === 'copy'
                ? [{ content: '已结算旅游文案', type: 'text' }]
                : [{ documentId: 'document-safe', type: 'document' }],
            code: null,
            createdAt: new Date('2026-09-03T08:00:00.000Z'),
            id: taskId,
            status: 'succeeded',
            type,
            updatedAt: new Date('2026-09-03T09:00:00.000Z'),
            workspaceId,
          },
        ],
        [
          {
            generationId: canonicalGenerationId,
            generationType: 'agent-runtime-text-step',
            id: 'canonical-credit-entry',
          },
        ],
      );

      const detail = await customerCaller(workspaceId).getGenerationDetail({ id: taskId });

      expect(detail).toMatchObject({ settlementStatus: 'settled', status: 'succeeded', type });
      const settlementQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[1][0]);
      expect(settlementQuery.params).toEqual(
        expect.arrayContaining([
          canonicalGenerationId,
          taskId,
          customerId,
          'usage_charge',
          workspaceId,
        ]),
      );
      expect(settlementQuery.params).not.toContain(otherUserId);
    },
  );

  it('requires every safe image artifact charge before exposing a succeeded image', async () => {
    const taskId = 'multi-image-generation';
    const task = {
      artifacts: [
        { generationId: 'image-safe-a', type: 'image', url: '/f/image-safe-a.png' },
        { generationId: 'image-safe-b', type: 'image', url: '/f/image-safe-b.png' },
        { generationId: '../image-unsafe', type: 'image', url: '/f/image-unsafe.png' },
      ],
      code: null,
      createdAt: new Date('2026-09-03T08:00:00.000Z'),
      id: taskId,
      status: 'succeeded',
      type: 'image',
      updatedAt: new Date('2026-09-03T09:00:00.000Z'),
      workspaceId,
    };
    mocks.pageRows.push(
      [task],
      [
        {
          generationId: 'image-safe-a',
          generationType: 'platform-image-generation',
          id: 'partial-credit-entry',
        },
      ],
    );

    const detail = await customerCaller(workspaceId).getGenerationDetail({ id: taskId });

    expect(detail).toMatchObject({ artifacts: [], settlementStatus: 'pending' });
    const settlementQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[1][0]);
    expect(settlementQuery.params).toEqual(
      expect.arrayContaining([
        taskId,
        'image-safe-a',
        'image-safe-b',
        customerId,
        'usage_charge',
        workspaceId,
      ]),
    );
    expect(settlementQuery.params).not.toContain('../image-unsafe');
    expect(settlementQuery.params).not.toContain(otherUserId);
  });

  it('requires the canonical settlement type for every image artifact', async () => {
    const taskId = 'typed-multi-image-generation';
    mocks.pageRows.push(
      [
        {
          artifacts: [
            { generationId: 'typed-image-a', type: 'image', url: '/f/typed-image-a.png' },
            { generationId: 'typed-image-b', type: 'image', url: '/f/typed-image-b.png' },
          ],
          code: null,
          createdAt: new Date('2026-09-03T08:00:00.000Z'),
          id: taskId,
          status: 'succeeded',
          type: 'image',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          workspaceId,
        },
      ],
      [
        {
          generationId: 'typed-image-a',
          generationType: 'platform-image-generation',
          id: 'correct-credit-entry',
        },
        {
          generationId: 'typed-image-b',
          generationType: 'agent-runtime-text-step',
          id: 'wrong-type-credit-entry',
        },
        {
          generationId: taskId,
          generationType: 'copy',
          id: 'wrong-legacy-type-credit-entry',
        },
      ],
    );

    const detail = await customerCaller(workspaceId).getGenerationDetail({ id: taskId });

    expect(detail).toMatchObject({ artifacts: [], settlementStatus: 'pending' });
  });

  it.each(['copy', 'document'] as const)(
    'does not unlock a %s artifact with a mismatched canonical settlement type',
    async (type) => {
      const taskId = `typed-${type}-generation`;
      mocks.pageRows.push(
        [
          {
            artifacts:
              type === 'copy'
                ? [{ content: '不得提前交付', type: 'text' }]
                : [{ documentId: 'typed-document', type: 'document' }],
            code: null,
            createdAt: new Date('2026-09-03T08:00:00.000Z'),
            id: taskId,
            status: 'succeeded',
            type,
            updatedAt: new Date('2026-09-03T09:00:00.000Z'),
            workspaceId,
          },
        ],
        [
          {
            generationId: `travel-generation:${taskId}:step:0:call_llm`,
            generationType: 'platform-image-generation',
            id: 'wrong-type-credit-entry',
          },
          {
            generationId: taskId,
            generationType: 'image',
            id: 'wrong-legacy-type-credit-entry',
          },
        ],
      );

      const detail = await customerCaller(workspaceId).getGenerationDetail({ id: taskId });

      expect(detail).toMatchObject({ artifacts: [], settlementStatus: 'pending' });
    },
  );

  it('accepts one legacy task-id charge as the whole-image fallback', async () => {
    const taskId = 'legacy-image-generation';
    mocks.pageRows.push(
      [
        {
          artifacts: [
            { generationId: 'legacy-image-a', type: 'image', url: '/f/legacy-image-a.png' },
            { generationId: 'legacy-image-b', type: 'image', url: '/f/legacy-image-b.png' },
          ],
          code: null,
          createdAt: new Date('2026-09-03T08:00:00.000Z'),
          id: taskId,
          status: 'succeeded',
          type: 'image',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          workspaceId,
        },
      ],
      [{ generationId: taskId, generationType: 'image', id: 'legacy-credit-entry' }],
    );

    const detail = await customerCaller(workspaceId).getGenerationDetail({ id: taskId });

    expect(detail).toMatchObject({ settlementStatus: 'settled', status: 'succeeded' });
  });

  it('withholds successful artifacts until the active-workspace Credits settlement exists', async () => {
    mocks.pageRows.push(
      [
        {
          artifacts: [{ generationId: 'safe-image', type: 'image', url: '/f/safe-image.png' }],
          code: null,
          createdAt: new Date('2026-09-03T08:00:00.000Z'),
          id: 'unsettled-generation',
          status: 'succeeded',
          type: 'image',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          workspaceId,
        },
      ],
      [],
    );

    const detail = await customerCaller(workspaceId).getGenerationDetail({
      id: 'unsettled-generation',
    });

    expect(detail).toMatchObject({
      artifacts: [],
      id: 'unsettled-generation',
      settlementStatus: 'pending',
      status: 'succeeded',
    });
    expect(mocks.pageWhere).toHaveBeenCalledTimes(2);
    for (const [condition] of mocks.pageWhere.mock.calls) {
      const query = new PgDialect().sqlToQuery(condition);
      expect(query.params).toContain(customerId);
      expect(query.params).toContain(workspaceId);
      expect(query.params).not.toContain(otherUserId);
    }
  });

  it('keeps only successful copy, image or document works with minimal fields', () => {
    const page = buildCustomerWorkPage(
      [
        {
          description: 'PRIVATE_DESCRIPTION',
          id: 'image-work',
          provider: 'PRIVATE_PROVIDER',
          resourceType: 'image',
          source: 'work',
          status: 'completed',
          title: '九寨沟封面',
          type: 'external',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
          url: 'https://private.example/image.png',
        },
        {
          id: 'task-work',
          resourceType: 'linear_issue',
          source: 'work',
          status: 'completed',
          title: '非旅游生成任务',
          type: 'task',
          updatedAt: new Date('2026-09-03T08:30:00.000Z'),
        },
        {
          fileType: 'text/markdown',
          id: 'document-work',
          source: 'document',
          title: '九寨沟行程',
          updatedAt: new Date('2026-09-03T08:00:00.000Z'),
        },
        {
          id: 'fake-video',
          resourceType: 'video',
          source: 'work',
          status: 'unavailable',
          title: '虚假视频',
          type: 'external',
          updatedAt: new Date('2026-09-03T07:00:00.000Z'),
        },
      ] as never,
      20,
    );

    expect(page.items).toEqual([
      {
        id: 'image-work',
        source: 'work',
        status: 'succeeded',
        title: '九寨沟封面',
        type: 'image',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
      },
      {
        id: 'document-work',
        source: 'document',
        status: 'succeeded',
        title: '九寨沟行程',
        type: 'document',
        updatedAt: new Date('2026-09-03T08:00:00.000Z'),
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(
      /PRIVATE_DESCRIPTION|PRIVATE_PROVIDER|private\.example|task-work|fake-video/,
    );
    expect(buildCustomerWorkPage(page.items, 20, undefined, { status: 'failed' }).items).toEqual(
      [],
    );
  });

  it('projects only complete successful native image and video generations', () => {
    const page = buildCustomerWorkPage(
      [
        {
          asset: { url: 'PRIVATE_ASSET_KEY' },
          asyncTaskId: 'PRIVATE_ASYNC_TASK_ID',
          fileId: 'PRIVATE_FILE_ID',
          id: 'native-image',
          model: 'PRIVATE_MODEL',
          prompt: 'PRIVATE_PROMPT',
          provider: 'PRIVATE_PROVIDER',
          source: 'generation',
          status: 'success',
          title: '西藏旅游封面',
          topicId: 'image-topic',
          type: 'image',
          updatedAt: new Date('2026-09-03T10:00:00.000Z'),
          url: 'https://private.example/image.png',
        },
        {
          asset: { duration: 5 },
          fileId: 'PRIVATE_VIDEO_FILE_ID',
          id: 'native-video',
          source: 'generation',
          status: 'success',
          title: '西藏旅游视频',
          topicId: 'video-topic',
          type: 'video',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        },
        {
          asset: null,
          fileId: 'incomplete-file',
          id: 'missing-asset',
          source: 'generation',
          status: 'success',
          topicId: 'image-topic',
          type: 'image',
          updatedAt: new Date('2026-09-03T08:00:00.000Z'),
        },
        {
          asset: { url: 'asset-key' },
          fileId: null,
          id: 'missing-file',
          source: 'generation',
          status: 'success',
          topicId: 'image-topic',
          type: 'image',
          updatedAt: new Date('2026-09-03T07:00:00.000Z'),
        },
        {
          asset: { url: 'asset-key' },
          fileId: 'pending-file',
          id: 'pending-generation',
          source: 'generation',
          status: 'processing',
          topicId: 'video-topic',
          type: 'video',
          updatedAt: new Date('2026-09-03T06:00:00.000Z'),
        },
      ] as never,
      20,
    );

    expect(page.items).toEqual([
      {
        id: 'native-image',
        source: 'generation',
        title: '西藏旅游封面',
        topicId: 'image-topic',
        type: 'image',
        updatedAt: new Date('2026-09-03T10:00:00.000Z'),
      },
      {
        id: 'native-video',
        source: 'generation',
        title: '西藏旅游视频',
        topicId: 'video-topic',
        type: 'video',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(
      /PRIVATE_ASSET|PRIVATE_ASYNC|PRIVATE_FILE|PRIVATE_MODEL|PRIVATE_PROMPT|PRIVATE_PROVIDER|private\.example/,
    );
  });

  it('rejects unsupported generation filters and reversed date ranges before querying', async () => {
    await expect(
      (customerCaller() as any).getPage({ kind: 'generation', limit: 20, type: 'audio' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({ kind: 'generation', limit: 20, status: 'internal' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({
        dateFrom: '2026-09-03T00:00:00.000Z',
        dateTo: '2026-09-02T00:00:00.000Z',
        kind: 'generation',
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(serverDB.select).not.toHaveBeenCalled();
  });

  it('accepts bounded customer generation filters', async () => {
    mocks.pageRows.push([]);

    await expect(
      (customerCaller() as any).getPage({
        dateFrom: '2026-09-01T00:00:00.000Z',
        dateTo: '2026-09-03T23:59:59.999Z',
        kind: 'generation',
        limit: 20,
        status: 'processing',
        type: 'image',
      }),
    ).resolves.toEqual({ items: [], kind: 'generation', nextCursor: null });
    expect(mocks.pageLimits).toHaveBeenCalledWith(21);
  });

  it('builds stable updatedAt + id pages without repeats and ends on an empty page', () => {
    const rows = [
      { id: 'item-a', updatedAt: new Date('2026-09-03T08:00:00.000Z') },
      { id: 'item-c', updatedAt: new Date('2026-09-03T09:00:00.000Z') },
      { id: 'item-b', updatedAt: new Date('2026-09-03T09:00:00.000Z') },
      { id: 'item-a', updatedAt: new Date('2026-09-03T06:00:00.000Z') },
      { id: 'item-z', updatedAt: new Date('2026-09-03T07:00:00.000Z') },
    ];

    const first = buildCustomerCenterPage(rows, 2);
    expect(first.items.map(({ id }) => id)).toEqual(['item-c', 'item-b']);
    expect(decodeCustomerCenterCursor(first.nextCursor!)).toEqual({
      id: 'item-b',
      updatedAt: new Date('2026-09-03T09:00:00.000Z'),
    });

    const second = buildCustomerCenterPage(rows, 2, first.nextCursor!);
    expect(second.items.map(({ id }) => id)).toEqual(['item-a', 'item-z']);
    expect(second.items[0].updatedAt).toEqual(new Date('2026-09-03T08:00:00.000Z'));
    expect(second.nextCursor).toBeNull();

    const finalCursor = encodeCustomerCenterCursor(second.items.at(-1)!);
    expect(buildCustomerCenterPage(rows, 2, finalCursor)).toEqual({ items: [], nextCursor: null });
    expect(buildCustomerCenterPage([], 20)).toEqual({ items: [], nextCursor: null });
  });

  it('rejects malformed cursors and page sizes before any customer data query runs', async () => {
    await expect(
      (customerCaller() as any).getPage({ cursor: 'not-a-cursor', kind: 'ledger', limit: 20 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({ kind: 'ledger', limit: 0 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({ kind: 'work', limit: 51 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({ cursor: 'x'.repeat(513), kind: 'generation', limit: 20 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({
        dateFrom: `2026-09-01T00:00:00.000Z${'x'.repeat(1024)}`,
        kind: 'generation',
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({
        kind: 'generation',
        limit: 20,
        userId: otherUserId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getPage({
        kind: 'generation',
        limit: 20,
        targetUserId: otherUserId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getGenerationDetail({
        id: 'generation-safe-id',
        targetUserId: otherUserId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      (customerCaller() as any).getGenerationDetail({ id: 'x'.repeat(256) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(mocks.creditGetAccount).not.toHaveBeenCalled();
    expect(mocks.creditListEntries).not.toHaveBeenCalled();
    expect(mocks.contentGetOverview).not.toHaveBeenCalled();
    expect(mocks.usageGetUsage).not.toHaveBeenCalled();
  });

  it('keeps a structurally valid foreign cursor inside the signed-in customer scope', async () => {
    mocks.pageRows.push([]);
    const foreignCursor = encodeCustomerCenterCursor({
      id: 'other-user-row',
      updatedAt: new Date('2026-09-03T09:00:00.000Z'),
    });

    await expect(
      (customerCaller() as any).getPage({
        cursor: foreignCursor,
        kind: 'generation',
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], kind: 'generation', nextCursor: null });

    const pageQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[0][0]);
    expect(pageQuery.params).toContain(customerId);
    expect(pageQuery.params).not.toContain(otherUserId);
  });

  it.each(['generation', 'ledger', 'work'] as const)(
    'keeps the %s page inside the active workspace',
    async (kind) => {
      mocks.pageRows.push([], ...(kind === 'work' ? [[]] : []));

      await expect(customerCaller(workspaceId).getPage({ kind, limit: 20 })).resolves.toEqual({
        ...(kind === 'ledger' ? { total: 0 } : {}),
        items: [],
        kind,
        nextCursor: null,
      });

      for (const [condition] of mocks.pageWhere.mock.calls) {
        const pageQuery = new PgDialect().sqlToQuery(condition);
        expect(pageQuery.params).toContain(customerId);
        expect(pageQuery.params).toContain(workspaceId);
        expect(pageQuery.params).not.toContain(otherUserId);
      }
    },
  );

  it('mixes owned native generations into the work page with four-table workspace isolation', async () => {
    mocks.pageRows.push(
      [
        {
          id: 'work-image',
          resourceType: 'image',
          status: 'completed',
          title: '现有作品',
          type: 'external',
          updatedAt: new Date('2026-09-03T08:00:00.000Z'),
        },
      ],
      [
        {
          fileType: 'text/markdown',
          id: 'document-work',
          title: '现有文稿',
          updatedAt: new Date('2026-09-03T07:00:00.000Z'),
        },
      ],
      [
        {
          asset: { duration: 6 },
          fileId: 'native-video-file',
          id: 'native-video',
          status: 'success',
          title: '原生旅游视频',
          topicId: 'native-video-topic',
          type: 'video',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        },
      ],
    );

    const page = await customerCaller(workspaceId).getPage({ kind: 'work', limit: 20 });

    expect(page.items.map(({ id }: { id: string }) => id)).toEqual([
      'native-video',
      'work-image',
      'document-work',
    ]);
    expect(page.items[0]).toEqual({
      id: 'native-video',
      source: 'generation',
      title: '原生旅游视频',
      topicId: 'native-video-topic',
      type: 'video',
      updatedAt: new Date('2026-09-03T09:00:00.000Z'),
    });
    expect(JSON.stringify(page)).not.toMatch(/fileId|asset|prompt|provider|model|url|asyncTaskId/);

    const nativeQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[2][0]);
    expect(nativeQuery.params.filter((value) => value === customerId)).toHaveLength(4);
    expect(nativeQuery.params.filter((value) => value === workspaceId)).toHaveLength(4);
    expect(nativeQuery.params).toEqual(
      expect.arrayContaining(['success', 'image', 'image_generation', 'video', 'video_generation']),
    );
    expect(nativeQuery.params).not.toContain(otherUserId);
  });

  it('hides platform-managed images without an owned workspace-scoped usage settlement', async () => {
    mocks.pageRows.push(
      [],
      [],
      [
        {
          asset: { url: 'PRIVATE_ASSET_KEY' },
          fileId: 'platform-image-file',
          id: 'platform-image-generation',
          metadata: { platformAiRuntime: true },
          status: 'success',
          title: '未结算平台图片',
          topicId: 'platform-image-topic',
          type: 'image',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        },
      ],
      [],
    );

    const page = await customerCaller(workspaceId).getPage({ kind: 'work', limit: 20 });

    expect(page.items).toEqual([]);
    expect(mocks.pageWhere).toHaveBeenCalledTimes(4);

    const settlementQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[3][0]);
    expect(settlementQuery.params).toEqual(
      expect.arrayContaining([
        'usage_charge',
        'platform-image-generation',
        'platform-image-generation',
        customerId,
        workspaceId,
      ]),
    );
    expect(settlementQuery.params.filter((value) => value === customerId)).toHaveLength(2);
    expect(settlementQuery.params).not.toContain(otherUserId);
  });

  it('shows a platform-managed image after its canonical usage settlement is present', async () => {
    mocks.pageRows.push(
      [],
      [],
      [
        {
          asset: { url: 'PRIVATE_ASSET_KEY' },
          fileId: 'platform-image-file',
          id: 'settled-platform-image',
          metadata: { platformAiRuntime: true },
          status: 'success',
          title: '已结算平台图片',
          topicId: 'platform-image-topic',
          type: 'image',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        },
      ],
      [{ generationId: 'settled-platform-image' }],
    );

    const page = await customerCaller(workspaceId).getPage({ kind: 'work', limit: 20 });

    expect(page.items).toEqual([
      {
        id: 'settled-platform-image',
        source: 'generation',
        title: '已结算平台图片',
        topicId: 'platform-image-topic',
        type: 'image',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/metadata|fileId|asset|platformAiRuntime/);
  });

  it.each(['image', 'video'] as const)(
    'applies the %s type filter to native generation topics',
    async (type) => {
      mocks.pageRows.push([], [], []);

      await customerCaller(workspaceId).getPage({ kind: 'work', limit: 20, type });

      const nativeQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls.at(-1)![0]);
      expect(nativeQuery.params.filter((value) => value === type)).toHaveLength(2);
    },
  );

  it('does not query native media for a document-only work page', async () => {
    mocks.pageRows.push([], []);

    await customerCaller(workspaceId).getPage({ kind: 'work', limit: 20, type: 'document' });

    expect(mocks.pageWhere).toHaveBeenCalledTimes(2);
  });

  it('reads only limit + 1 ledger rows and returns a bounded customer-safe page', async () => {
    mocks.pageRows.push(
      Array.from({ length: 21 }, (_, index) => ({
        amountCredits: index,
        balanceAfterCredits: 1000 + index,
        createdAt: new Date(`2026-09-03T08:${String(index).padStart(2, '0')}:00.000Z`),
        id: `entry-${String(index).padStart(2, '0')}`,
        type: 'top_up',
        updatedAt: new Date(`2026-09-03T08:${String(index).padStart(2, '0')}:00.000Z`),
      })),
    );

    const page = await (customerCaller() as any).getPage({ kind: 'ledger', limit: 20 });

    expect(mocks.pageLimits).toHaveBeenCalledOnce();
    expect(mocks.pageLimits).toHaveBeenCalledWith(21);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(Object.keys(page.items[0]).sort()).toEqual([
      'amountCredits',
      'balanceAfterCredits',
      'createdAt',
      'id',
      'type',
      'updatedAt',
    ]);
  });

  it.each([0, 73])(
    'returns the full scoped ledger total %s independently of the page cursor',
    async (total) => {
      mocks.pageTotal = total;
      const page = await customerCaller(workspaceId).getPage({
        kind: 'ledger',
        limit: 10,
        cursor: encodeCustomerCenterCursor({
          id: 'entry-cursor',
          updatedAt: new Date('2026-09-03T08:00:00Z'),
        }),
      });
      expect(page).toMatchObject({ kind: 'ledger', total, items: [] });
      const scope = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls.at(-1)![0]);
      expect(scope.params).toEqual([customerId, workspaceId]);
    },
  );

  it('returns a bounded customer-safe service-order page', async () => {
    mocks.pageRows.push([
      {
        accountId: 'ACCOUNT_ID_MUST_NOT_LEAK',
        amountFen: 128_800,
        createdAt: new Date('2026-09-03T08:00:00.000Z'),
        id: 'order-safe-id',
        idempotencyKey: 'IDEMPOTENCY_KEY_MUST_NOT_LEAK',
        status: 'completed',
        title: '九寨沟私家团',
        updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        userId: customerId,
      },
    ]);

    const page = await (customerCaller() as any).getPage({ kind: 'order', limit: 20 });

    expect(page).toEqual({
      items: [
        {
          amountFen: 128_800,
          createdAt: new Date('2026-09-03T08:00:00.000Z'),
          id: 'order-safe-id',
          status: 'completed',
          title: '九寨沟私家团',
          updatedAt: new Date('2026-09-03T09:00:00.000Z'),
        },
      ],
      kind: 'order',
      nextCursor: null,
    });
    expect(mocks.pageLimits).toHaveBeenCalledWith(21);
    const orderQuery = new PgDialect().sqlToQuery(mocks.pageWhere.mock.calls[0][0]);
    expect(orderQuery.params).toContain(customerId);
    expect(orderQuery.params).not.toContain(otherUserId);
    expect(JSON.stringify(page)).not.toMatch(/ACCOUNT_ID|IDEMPOTENCY_KEY|customer-center-customer/);
  });

  it('derives every model scope from ctx.userId and rejects a client-supplied target user', async () => {
    await expect(
      customerCenterRouter.createCaller({ serverDB } as any).getOverview({}),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    await expect(
      customerCaller().getOverview({ recentLimit: 5, userId: otherUserId } as any),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mocks.creditModelConstructor).not.toHaveBeenCalled();
    expect(mocks.usageModelConstructor).not.toHaveBeenCalled();
    expect(mocks.contentModelConstructor).not.toHaveBeenCalled();

    const result = await customerCaller().getOverview({ ledgerLimit: 20, recentLimit: 5 });

    expect(mocks.creditModelConstructor).toHaveBeenCalledWith(serverDB, customerId);
    expect(mocks.usageModelConstructor).toHaveBeenCalledWith(serverDB, customerId);
    expect(mocks.contentModelConstructor).toHaveBeenCalledWith(serverDB);
    expect(mocks.contentGetOverview).toHaveBeenCalledWith(customerId, { recentLimit: 5 });
    expect(mocks.creditListEntries).toHaveBeenCalledWith(20);
    expect(mocks.usageGetUsage).toHaveBeenCalledWith({ recentLimit: 5 });
    expect(result.credits.account?.balanceCredits).toBe(1_750_000);
    expect(result.usage?.canonicalTotals).toEqual(availableMetrics);
  });

  it('reports spendable credits separately from the ledger balance', async () => {
    mocks.creditGetAccount.mockResolvedValueOnce({
      availableCredits: 100_000,
      balanceCredits: 1_000_000,
      heldCredits: 900_000,
      updatedAt: new Date('2026-09-07T00:00:00Z'),
    });
    const result = await customerCaller().getOverview({});
    expect(result.credits.account).toMatchObject({
      availableCredits: 100_000,
      balanceCredits: 1_000_000,
      heldCredits: 900_000,
    });
  });

  it('rejects fractional Credits from either the balance or ledger instead of rounding them', async () => {
    mocks.creditGetAccount.mockResolvedValueOnce({ balanceCredits: 10.5 });
    const invalidAccount = await customerCaller().getOverview({});
    expect(invalidAccount.credits.account).toBeNull();
    expect(invalidAccount.credits.entries).not.toBeNull();

    mocks.creditGetAccount.mockResolvedValueOnce({ balanceCredits: -1 });
    const negativeAccount = await customerCaller().getOverview({});
    expect(negativeAccount.credits.account).toBeNull();
    expect(negativeAccount.credits.entries).not.toBeNull();

    mocks.creditGetAccount.mockResolvedValueOnce({
      balanceCredits: 10,
      availableCredits: 10,
      heldCredits: 0,
    });
    mocks.creditListEntries.mockResolvedValueOnce([
      { amountCredits: -0.5, balanceAfterCredits: 9.5, id: 'fractional-entry' },
    ]);
    const invalidLedger = await customerCaller().getOverview({});
    expect(invalidLedger.credits.account).not.toBeNull();
    expect(invalidLedger.credits.entries).toBeNull();
  });

  it('isolates balance, ledger, usage and content failures from healthy sections', async () => {
    mocks.creditGetAccount.mockRejectedValueOnce(new Error('balance unavailable'));
    mocks.usageGetUsage.mockRejectedValueOnce(new Error('usage unavailable'));

    const first = await customerCaller().getOverview({});
    expect(first.credits.account).toBeNull();
    expect(first.credits.entries).toHaveLength(1);
    expect(first.usage).toBeNull();
    expect(first.content.creations?.recentWorks).toHaveLength(1);
    expect(first.content).not.toHaveProperty('privateGroup');

    mocks.creditListEntries.mockRejectedValueOnce(new Error('ledger unavailable'));
    mocks.contentGetOverview.mockRejectedValueOnce(new Error('content unavailable'));

    const second = await customerCaller().getOverview({});
    expect(second.credits.account?.balanceCredits).toBe(1_750_000);
    expect(second.credits.entries).toBeNull();
    expect(second.usage?.canonicalTotals).toEqual(availableMetrics);
    expect(second.content).toEqual({ creations: null });
  });

  it('never includes the private-group summary in the customer projection', async () => {
    mocks.contentGetOverview.mockResolvedValueOnce({
      generation: { statusCounts: [], total: 0 },
      recentDocuments: [],
      recentGenerationTasks: [],
      recentWorks: [],
      travelGroup: {
        expectedMemberCount: 1,
        id: 'group-safe-id',
        memberCount: 1,
        readiness: 'ready',
        ready: true,
        supervisorCount: 1,
        title: '本人私人群',
        updatedAt: new Date('2026-09-02T08:00:00.000Z'),
      },
    });

    const result = await customerCaller().getOverview({});
    expect(result.content.creations?.recentWorks).toEqual([]);
    expect(result.content).not.toHaveProperty('privateGroup');
  });

  it('returns only the customer-safe Credits, usage, and personal-content allowlist', async () => {
    const result = await customerCaller().getOverview({ ledgerLimit: 20, recentLimit: 5 });

    expect(result).toMatchObject({
      content: {
        creations: {
          generation: { statusCounts: [{ count: 2, status: 'succeeded' }], total: 2 },
          recentDocuments: [{ id: 'document-safe-id', title: '西藏文案' }],
          recentGenerationTasks: [
            {
              id: 'generation-task-safe-id',
              status: 'succeeded',
              title: null,
              type: 'copy',
            },
          ],
          recentWorks: [{ id: 'work-safe-id', title: '西藏旅游文案' }],
        },
      },
      credits: {
        account: { balanceCredits: 1_750_000 },
        entries: [
          {
            amountCredits: -250,
            balanceAfterCredits: 1_750_000,
            id: 'credit-entry-safe-id',
            type: 'usage_charge',
          },
        ],
      },
      usage: {
        canonicalTotals: availableMetrics,
      },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('group-safe-id');
    for (const forbidden of [
      'balanceFen',
      'amountFen',
      'credit-account-id-must-not-leak',
      'IDEMPOTENCY_KEY_MUST_NOT_LEAK',
      'OPERATOR_USER_ID_MUST_NOT_LEAK',
      'TOOL_ARGUMENTS_MUST_NOT_LEAK',
      'WORKSPACE_ID_MUST_NOT_LEAK',
      'USAGE_PROMPT_MUST_NOT_LEAK',
      'MESSAGE_BODY_MUST_NOT_LEAK',
      'USAGE_TOOL_PARAMETERS_MUST_NOT_LEAK',
      'GENERATION_PROMPT_MUST_NOT_LEAK',
      'GENERATION_PRIVATE_ARTIFACT_MUST_NOT_LEAK',
      'GENERATION_TASK_PROMPT_MUST_NOT_LEAK',
      'GENERATION_TASK_MESSAGE_MUST_NOT_LEAK',
      'GENERATION_PROVIDER_INTERNAL_MUST_NOT_LEAK',
      'GENERATION_USAGE_RAW_MUST_NOT_LEAK',
      'DOCUMENT_BODY_MUST_NOT_LEAK',
      'DOCUMENT_KEY_MUST_NOT_LEAK',
      'DOCUMENT_SOURCE_MUST_NOT_LEAK',
      'WORK_BODY_MUST_NOT_LEAK',
      'WORK_URL_MUST_NOT_LEAK',
      'GROUP_CONFIG_MUST_NOT_LEAK',
      '模型用量扣费',
      'generation-safe-id',
      'deepseek-chat',
      'deepseek',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(Object.keys(result.credits.entries![0]).sort()).toEqual([
      'amountCredits',
      'balanceAfterCredits',
      'createdAt',
      'id',
      'type',
      'updatedAt',
    ]);
    expect(Object.keys(result.usage!)).toEqual(['canonicalTotals']);
  });
});
