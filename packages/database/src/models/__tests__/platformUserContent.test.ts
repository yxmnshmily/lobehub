// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agents,
  chatGroups,
  chatGroupsAgents,
  documents,
  travelGenerationTasks,
  users,
  works,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { PlatformUserContentModel } from '../platformUserContent';

const db: LobeChatDatabase = await getTestDB();
const targetUserId = 'platform-content-target';
const otherUserId = 'platform-content-other';

beforeEach(async () => {
  await db.delete(users).where(eq(users.id, targetUserId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.insert(users).values([{ id: targetUserId }, { id: otherUserId }]);
});

afterEach(async () => {
  await db.delete(users).where(eq(users.id, targetUserId));
  await db.delete(users).where(eq(users.id, otherUserId));
});

describe('PlatformUserContentModel', () => {
  it('returns one user content overview without leaking prompts, bodies, provider data, or group config', async () => {
    const targetGroupId = 'platform-content-group-target';
    const otherGroupId = 'platform-content-group-other';
    await db.insert(agents).values([
      {
        clientId: 'platform-content-supervisor',
        id: 'platform-content-agent-supervisor',
        slug: 'platform-content-supervisor',
        title: '旅游群主AI',
        userId: targetUserId,
      },
      {
        clientId: 'platform-content-writer',
        id: 'platform-content-agent-writer',
        slug: 'platform-content-writer',
        title: '旅游文案助理',
        userId: targetUserId,
      },
      {
        clientId: 'platform-content-other-agent',
        id: 'platform-content-agent-other',
        slug: 'platform-content-other-agent',
        userId: otherUserId,
      },
    ]);
    await db.insert(chatGroups).values([
      {
        clientId: 'default-travel-service-group',
        config: {
          memberSlots: [
            {
              agentId: 'platform-content-agent-supervisor',
              configurable: true,
              key: 'owner',
              label: '旅游群主AI',
              role: 'supervisor',
              status: 'configured',
            },
            {
              agentId: 'platform-content-agent-writer',
              configurable: true,
              key: 'writer',
              label: '旅游文案助理',
              role: 'participant',
              status: 'configured',
            },
          ],
          systemPrompt: 'GROUP_CONFIG_MUST_NOT_LEAK',
        },
        content: 'GROUP_SYSTEM_PROMPT_MUST_NOT_LEAK',
        id: targetGroupId,
        title: '旅游服务超级群组',
        userId: targetUserId,
        visibility: 'private',
      },
      {
        clientId: 'default-travel-service-group',
        id: otherGroupId,
        title: '其他用户的群组',
        userId: otherUserId,
        visibility: 'private',
      },
    ]);
    await db.insert(chatGroupsAgents).values([
      {
        agentId: 'platform-content-agent-supervisor',
        chatGroupId: targetGroupId,
        enabled: true,
        role: 'supervisor',
        userId: targetUserId,
      },
      {
        agentId: 'platform-content-agent-writer',
        chatGroupId: targetGroupId,
        enabled: true,
        role: 'participant',
        userId: targetUserId,
      },
      {
        agentId: 'platform-content-agent-other',
        chatGroupId: otherGroupId,
        enabled: true,
        role: 'supervisor',
        userId: otherUserId,
      },
      {
        agentId: 'platform-content-agent-other',
        chatGroupId: targetGroupId,
        enabled: true,
        role: 'participant',
        userId: otherUserId,
      },
    ]);

    await db.insert(travelGenerationTasks).values([
      {
        groupId: targetGroupId,
        id: 'platform-content-generation-succeeded',
        input: { prompt: 'TARGET_GENERATION_PROMPT_MUST_NOT_LEAK' },
        message: 'TARGET_PROVIDER_MESSAGE_MUST_NOT_LEAK',
        provider: 'TARGET_PROVIDER_MUST_NOT_LEAK',
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
        userId: targetUserId,
      },
      {
        groupId: targetGroupId,
        id: 'platform-content-generation-failed',
        input: { prompt: '生成失败的封面' },
        status: 'failed',
        type: 'image',
        updatedAt: new Date('2026-09-02T11:00:00.000Z'),
        userId: targetUserId,
      },
      {
        groupId: targetGroupId,
        id: 'platform-content-generation-running',
        input: { prompt: '正在生成的视频' },
        status: 'running',
        type: 'video',
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        userId: targetUserId,
      },
      {
        groupId: otherGroupId,
        id: 'platform-content-generation-other',
        input: { prompt: 'OTHER_USER_PROMPT_MUST_NOT_LEAK' },
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T13:00:00.000Z'),
        userId: otherUserId,
      },
    ]);

    await db.insert(works).values([
      {
        description: 'WORK_BODY_PREVIEW_MUST_NOT_LEAK',
        id: 'platform-content-work-new',
        resourceType: 'document',
        status: 'completed',
        title: '西藏旅游文案',
        toolIdentifier: 'lobe-agent-documents',
        toolName: 'createDocument',
        type: 'document',
        updatedAt: new Date('2026-09-02T10:00:00.000Z'),
        url: 'https://private.example/WORK_URL_MUST_NOT_LEAK',
        userId: targetUserId,
        visibility: 'private',
      },
      {
        id: 'platform-content-work-old',
        resourceType: 'task',
        status: 'pending',
        title: '成都行程任务',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        updatedAt: new Date('2026-09-02T09:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
      },
      {
        id: 'platform-content-work-other',
        resourceType: 'task',
        title: 'OTHER_USER_WORK_MUST_NOT_LEAK',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        userId: otherUserId,
        visibility: 'private',
      },
    ]);

    await db.insert(documents).values([
      {
        content: 'DOCUMENT_BODY_MUST_NOT_LEAK',
        fileType: 'custom/folder',
        id: 'platform-content-document-folder',
        metadata: { token: 'DOCUMENT_METADATA_MUST_NOT_LEAK' },
        source: '/private/DOCUMENT_SOURCE_MUST_NOT_LEAK',
        sourceType: 'agent',
        title: '西藏项目',
        totalCharCount: 0,
        totalLineCount: 0,
        updatedAt: new Date('2026-09-02T08:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
      },
      {
        content: '西藏旅游文案正文',
        fileType: 'text/markdown',
        id: 'platform-content-document-page',
        parentId: 'platform-content-document-folder',
        source: 'page-editor',
        sourceType: 'agent',
        title: '封面文案',
        totalCharCount: 8,
        totalLineCount: 1,
        updatedAt: new Date('2026-09-02T11:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
      },
      {
        content: 'OTHER_USER_DOCUMENT_MUST_NOT_LEAK',
        fileType: 'text/markdown',
        id: 'platform-content-document-other',
        source: 'page-editor',
        sourceType: 'agent',
        title: 'OTHER_USER_DOCUMENT_TITLE_MUST_NOT_LEAK',
        totalCharCount: 1,
        totalLineCount: 1,
        userId: otherUserId,
        visibility: 'private',
      },
    ]);

    const result = await new PlatformUserContentModel(db).getOverview(targetUserId, {
      recentLimit: 2,
    });

    expect(result.travelGroup).toMatchObject({
      expectedMemberCount: 2,
      id: targetGroupId,
      memberCount: 2,
      readiness: 'ready',
      ready: true,
      supervisorCount: 1,
      title: '旅游服务超级群组',
    });
    expect(result.generation).toEqual({
      statusCounts: [
        { count: 1, status: 'failed' },
        { count: 1, status: 'running' },
        { count: 1, status: 'succeeded' },
      ],
      total: 3,
    });
    expect(result.recentGenerationTasks).toEqual([
      {
        createdAt: expect.any(Date),
        id: 'platform-content-generation-running',
        status: 'running',
        title: null,
        type: 'video',
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
      },
      {
        createdAt: expect.any(Date),
        id: 'platform-content-generation-failed',
        status: 'failed',
        title: null,
        type: 'image',
        updatedAt: new Date('2026-09-02T11:00:00.000Z'),
      },
    ]);
    expect(result.recentWorks).toEqual([
      expect.objectContaining({
        id: 'platform-content-work-new',
        resourceType: 'document',
        status: 'completed',
        title: '西藏旅游文案',
        type: 'document',
      }),
      expect.objectContaining({
        id: 'platform-content-work-old',
        resourceType: 'task',
        status: 'pending',
        title: '成都行程任务',
        type: 'task',
      }),
    ]);
    expect(result.recentDocuments).toEqual([
      expect.objectContaining({
        fileType: 'text/markdown',
        id: 'platform-content-document-page',
        parentId: 'platform-content-document-folder',
        title: '封面文案',
        totalCharCount: 8,
      }),
      expect.objectContaining({
        fileType: 'custom/folder',
        id: 'platform-content-document-folder',
        parentId: null,
        title: '西藏项目',
      }),
    ]);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'GROUP_CONFIG_MUST_NOT_LEAK',
      'GROUP_SYSTEM_PROMPT_MUST_NOT_LEAK',
      'TARGET_GENERATION_PROMPT_MUST_NOT_LEAK',
      'TARGET_PROVIDER_MESSAGE_MUST_NOT_LEAK',
      'TARGET_PROVIDER_MUST_NOT_LEAK',
      'platform-content-generation-other',
      'WORK_BODY_PREVIEW_MUST_NOT_LEAK',
      'WORK_URL_MUST_NOT_LEAK',
      'DOCUMENT_BODY_MUST_NOT_LEAK',
      'DOCUMENT_METADATA_MUST_NOT_LEAK',
      'DOCUMENT_SOURCE_MUST_NOT_LEAK',
      'OTHER_USER',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reports a missing managed travel group without exposing another user group', async () => {
    await db.insert(chatGroups).values({
      clientId: 'default-travel-service-group',
      id: 'platform-content-only-other-group',
      userId: otherUserId,
      visibility: 'private',
    });

    const result = await new PlatformUserContentModel(db).getOverview(targetUserId);

    expect(result.travelGroup).toEqual({
      expectedMemberCount: 0,
      id: null,
      memberCount: 0,
      readiness: 'missing',
      ready: false,
      supervisorCount: 0,
      title: null,
      updatedAt: null,
    });
    expect(result.generation).toEqual({ statusCounts: [], total: 0 });
    expect(result.recentGenerationTasks).toEqual([]);
    expect(result.recentDocuments).toEqual([]);
    expect(result.recentWorks).toEqual([]);
  });

  it('treats a same-user workspace travel group as missing from the personal overview', async () => {
    const workspaceId = 'platform-content-team-group-workspace';
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Team group',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(chatGroups).values({
      clientId: 'default-travel-service-group',
      id: 'platform-content-same-user-team-group-must-not-leak',
      title: 'Team group must not leak',
      userId: targetUserId,
      visibility: 'private',
      workspaceId,
    });

    const result = await new PlatformUserContentModel(db).getOverview(targetUserId);

    expect(result.travelGroup).toEqual({
      expectedMemberCount: 0,
      id: null,
      memberCount: 0,
      readiness: 'missing',
      ready: false,
      supervisorCount: 0,
      title: null,
      updatedAt: null,
    });
  });

  it('treats a public personal travel group as missing from the private-group overview', async () => {
    await db.insert(chatGroups).values({
      clientId: 'default-travel-service-group',
      id: 'platform-content-public-personal-group-must-not-leak',
      title: 'Public group must not leak',
      userId: targetUserId,
      visibility: 'public',
    });

    const result = await new PlatformUserContentModel(db).getOverview(targetUserId);

    expect(result.travelGroup).toEqual({
      expectedMemberCount: 0,
      id: null,
      memberCount: 0,
      readiness: 'missing',
      ready: false,
      supervisorCount: 0,
      title: null,
      updatedAt: null,
    });
  });

  it('ignores workspace memberships when assessing personal travel group readiness', async () => {
    const groupId = 'platform-content-personal-membership-scope-group';
    const workspaceId = 'platform-content-membership-workspace';
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Team membership',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(agents).values([
      {
        clientId: 'platform-content-personal-membership-supervisor',
        id: 'platform-content-personal-membership-supervisor-agent',
        slug: 'platform-content-personal-membership-supervisor',
        title: '旅游群主AI',
        userId: targetUserId,
      },
      {
        clientId: 'platform-content-team-membership-supervisor',
        id: 'platform-content-team-membership-supervisor-agent',
        slug: 'platform-content-team-membership-supervisor',
        title: 'Team supervisor must not count',
        userId: targetUserId,
        workspaceId,
      },
    ]);
    await db.insert(chatGroups).values({
      clientId: 'default-travel-service-group',
      config: {
        memberSlots: [
          {
            agentId: 'platform-content-personal-membership-supervisor-agent',
            configurable: true,
            key: 'owner',
            label: '旅游群主AI',
            role: 'supervisor',
            status: 'configured',
          },
        ],
      },
      content: 'Personal travel group prompt',
      id: groupId,
      title: '旅游服务超级群组',
      userId: targetUserId,
      visibility: 'private',
    });
    await db.insert(chatGroupsAgents).values([
      {
        agentId: 'platform-content-personal-membership-supervisor-agent',
        chatGroupId: groupId,
        enabled: true,
        role: 'supervisor',
        userId: targetUserId,
      },
      {
        agentId: 'platform-content-team-membership-supervisor-agent',
        chatGroupId: groupId,
        enabled: true,
        role: 'supervisor',
        userId: targetUserId,
        workspaceId,
      },
    ]);

    const result = await new PlatformUserContentModel(db).getOverview(targetUserId);

    expect(result.travelGroup).toMatchObject({
      id: groupId,
      memberCount: 1,
      readiness: 'ready',
      ready: true,
      supervisorCount: 1,
    });
  });

  it('excludes one user team workspace content from the personal catalog and overview', async () => {
    const personalGroupId = 'platform-content-personal-scope-group';
    const workspaceGroupId = 'platform-content-workspace-scope-group';
    const workspaceId = 'platform-content-team-workspace';
    await db.insert(workspaces).values({
      id: workspaceId,
      name: 'Team content',
      primaryOwnerId: targetUserId,
      slug: workspaceId,
    });
    await db.insert(chatGroups).values([
      {
        clientId: 'default-travel-service-group',
        id: personalGroupId,
        title: 'Personal group',
        userId: targetUserId,
        visibility: 'private',
      },
      {
        clientId: 'platform-content-workspace-group',
        id: workspaceGroupId,
        title: 'Team group',
        userId: targetUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    await db.insert(travelGenerationTasks).values([
      {
        groupId: personalGroupId,
        id: 'platform-content-personal-generation',
        input: { prompt: 'personal' },
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T10:00:00.000Z'),
        userId: targetUserId,
      },
      {
        groupId: workspaceGroupId,
        id: 'platform-content-workspace-generation-must-not-leak',
        input: { prompt: 'team' },
        status: 'failed',
        type: 'image',
        updatedAt: new Date('2026-09-02T13:00:00.000Z'),
        userId: targetUserId,
        workspaceId,
      },
    ]);
    await db.insert(works).values([
      {
        id: 'platform-content-personal-work',
        resourceType: 'task',
        status: 'pending',
        title: 'Personal work',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        updatedAt: new Date('2026-09-02T10:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
      },
      {
        id: 'platform-content-workspace-work-must-not-leak',
        resourceType: 'task',
        status: 'completed',
        title: 'Team work must not leak',
        toolIdentifier: 'lobe-task',
        toolName: 'createTask',
        type: 'task',
        updatedAt: new Date('2026-09-02T13:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);
    await db.insert(documents).values([
      {
        content: 'personal',
        fileType: 'text/markdown',
        id: 'platform-content-personal-document',
        source: 'page-editor',
        sourceType: 'agent',
        title: 'Personal document',
        totalCharCount: 8,
        totalLineCount: 1,
        updatedAt: new Date('2026-09-02T10:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
      },
      {
        content: 'team',
        fileType: 'text/markdown',
        id: 'platform-content-workspace-document-must-not-leak',
        source: 'page-editor',
        sourceType: 'agent',
        title: 'Team document must not leak',
        totalCharCount: 4,
        totalLineCount: 1,
        updatedAt: new Date('2026-09-02T13:00:00.000Z'),
        userId: targetUserId,
        visibility: 'private',
        workspaceId,
      },
    ]);

    const model = new PlatformUserContentModel(db);
    const [generationPage, workPage, documentPage, overview] = await Promise.all([
      model.listContentCatalog(targetUserId, { kind: 'generation' }),
      model.listContentCatalog(targetUserId, { kind: 'work' }),
      model.listContentCatalog(targetUserId, { kind: 'document' }),
      model.getOverview(targetUserId),
    ]);

    expect(generationPage.counts).toEqual({ documents: 1, generationTasks: 1, works: 1 });
    expect(generationPage.items.map(({ id }) => id)).toEqual([
      'platform-content-personal-generation',
    ]);
    expect(workPage.items.map(({ id }) => id)).toEqual(['platform-content-personal-work']);
    expect(documentPage.items.map(({ id }) => id)).toEqual(['platform-content-personal-document']);
    expect(overview.generation).toEqual({
      statusCounts: [{ count: 1, status: 'succeeded' }],
      total: 1,
    });
    expect(overview.recentGenerationTasks.map(({ id }) => id)).toEqual([
      'platform-content-personal-generation',
    ]);
    expect(overview.recentWorks.map(({ id }) => id)).toEqual(['platform-content-personal-work']);
    expect(overview.recentDocuments.map(({ id }) => id)).toEqual([
      'platform-content-personal-document',
    ]);
  });

  it('returns scoped summary counts and stable filtered generation pages without sensitive fields', async () => {
    const groupId = 'platform-content-catalog-group';
    await db.insert(chatGroups).values({
      clientId: 'platform-content-catalog-group',
      id: groupId,
      userId: targetUserId,
      visibility: 'private',
    });
    await db.insert(travelGenerationTasks).values([
      {
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        groupId,
        id: 'platform-content-catalog-generation-c',
        input: { prompt: 'CATALOG_PROMPT_C_MUST_NOT_LEAK' },
        provider: 'CATALOG_PROVIDER_C_MUST_NOT_LEAK',
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        usage: { totalInputTokens: 123_456 },
        userId: targetUserId,
      },
      {
        createdAt: new Date('2026-09-01T07:00:00.000Z'),
        groupId,
        id: 'platform-content-catalog-generation-b',
        input: { prompt: 'CATALOG_PROMPT_B_MUST_NOT_LEAK' },
        message: 'CATALOG_INTERNAL_ERROR_MUST_NOT_LEAK',
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        userId: targetUserId,
      },
      {
        createdAt: new Date('2026-09-01T06:00:00.000Z'),
        groupId,
        id: 'platform-content-catalog-generation-a',
        input: { prompt: 'CATALOG_PROMPT_A_MUST_NOT_LEAK' },
        status: 'failed',
        type: 'image',
        updatedAt: new Date('2026-09-02T10:00:00.000Z'),
        userId: targetUserId,
      },
      {
        createdAt: new Date('2026-09-01T09:00:00.000Z'),
        groupId,
        id: 'platform-content-catalog-generation-other',
        input: { prompt: 'CATALOG_OTHER_USER_PROMPT_MUST_NOT_LEAK' },
        status: 'succeeded',
        type: 'copy',
        updatedAt: new Date('2026-09-02T13:00:00.000Z'),
        userId: otherUserId,
      },
    ]);
    await db.insert(works).values({
      description: 'CATALOG_WORK_BODY_MUST_NOT_LEAK',
      id: 'platform-content-catalog-work',
      resourceType: 'document',
      status: 'completed',
      title: '目录作品',
      toolIdentifier: 'lobe-agent-documents',
      toolName: 'createDocument',
      type: 'document',
      url: 'https://private.example/CATALOG_WORK_URL_MUST_NOT_LEAK',
      userId: targetUserId,
      visibility: 'private',
    });
    await db.insert(documents).values({
      content: 'CATALOG_DOCUMENT_BODY_MUST_NOT_LEAK',
      fileType: 'text/markdown',
      filename: '目录文档.md',
      id: 'platform-content-catalog-document',
      source: '/private/CATALOG_DOCUMENT_SOURCE_MUST_NOT_LEAK',
      sourceType: 'agent',
      title: '目录文档',
      totalCharCount: 100,
      totalLineCount: 10,
      userId: targetUserId,
      visibility: 'private',
    });

    const model = new PlatformUserContentModel(db);
    const firstPage = await model.listContentCatalog(targetUserId, {
      endAt: new Date('2026-09-02T12:30:00.000Z'),
      kind: 'generation',
      limit: 1,
      startAt: new Date('2026-09-02T11:00:00.000Z'),
      status: 'succeeded',
      type: 'copy',
    });

    expect(firstPage).toEqual({
      counts: { documents: 1, generationTasks: 3, works: 1 },
      items: [
        {
          createdAt: new Date('2026-09-01T08:00:00.000Z'),
          filename: null,
          id: 'platform-content-catalog-generation-c',
          kind: 'generation',
          status: 'succeeded',
          title: null,
          type: 'copy',
          updatedAt: new Date('2026-09-02T12:00:00.000Z'),
        },
      ],
      nextCursor: expect.any(String),
    });

    const secondPage = await model.listContentCatalog(targetUserId, {
      cursor: firstPage.nextCursor!,
      endAt: new Date('2026-09-02T12:30:00.000Z'),
      kind: 'generation',
      limit: 1,
      startAt: new Date('2026-09-02T11:00:00.000Z'),
      status: 'succeeded',
      type: 'copy',
    });
    expect(secondPage.items.map(({ id }) => id)).toEqual(['platform-content-catalog-generation-b']);
    expect(secondPage.nextCursor).toBeNull();

    const serialized = JSON.stringify([firstPage, secondPage]);
    expect(serialized).not.toMatch(
      /CATALOG_(?:PROMPT|PROVIDER|INTERNAL|OTHER|WORK_BODY|WORK_URL|DOCUMENT_BODY|DOCUMENT_SOURCE)|usage|token/i,
    );
  });

  it('controls work titles and document filenames in the unified content projection', async () => {
    await db.insert(works).values({
      id: 'platform-content-catalog-controlled-work',
      resourceType: 'task',
      status: 'pending',
      title: `  西藏\n${'行'.repeat(130)}  `,
      toolIdentifier: 'lobe-task',
      toolName: 'createTask',
      type: 'task',
      userId: targetUserId,
      visibility: 'private',
    });
    await db.insert(documents).values({
      content: '正文不得返回',
      fileType: 'text/markdown',
      filename: '  行程\n单.md  ',
      id: 'platform-content-catalog-controlled-document',
      source: 'page-editor',
      sourceType: 'agent',
      title: '  行程\n摘要  ',
      totalCharCount: 6,
      totalLineCount: 1,
      userId: targetUserId,
      visibility: 'private',
    });

    const model = new PlatformUserContentModel(db);
    const workPage = await model.listContentCatalog(targetUserId, {
      kind: 'work',
      status: 'pending',
      type: 'task',
    });
    const documentPage = await model.listContentCatalog(targetUserId, {
      kind: 'document',
      type: 'text/markdown',
    });

    expect(workPage.items[0]).toMatchObject({
      filename: null,
      kind: 'work',
      status: 'pending',
      title: `西藏${'行'.repeat(118)}`,
      type: 'task',
    });
    expect(documentPage.items[0]).toMatchObject({
      filename: '行程单.md',
      kind: 'document',
      status: null,
      title: '行程摘要',
      type: 'text/markdown',
    });
    for (const item of [...workPage.items, ...documentPage.items]) {
      expect(Object.keys(item).sort()).toEqual([
        'createdAt',
        'filename',
        'id',
        'kind',
        'status',
        'title',
        'type',
        'updatedAt',
      ]);
    }
  });

  it('rejects invalid content catalog pagination and filter combinations', async () => {
    const model = new PlatformUserContentModel(db);

    await expect(
      model.listContentCatalog(targetUserId, { kind: 'generation', limit: 0 }),
    ).rejects.toThrow(/limit/i);
    await expect(
      model.listContentCatalog(targetUserId, { kind: 'generation', limit: 51 }),
    ).rejects.toThrow(/limit/i);
    await expect(
      model.listContentCatalog(targetUserId, { cursor: 'bad-cursor', kind: 'work' }),
    ).rejects.toThrow(/cursor/i);
    await expect(
      model.listContentCatalog(targetUserId, { kind: 'document', status: 'completed' }),
    ).rejects.toThrow(/status/i);
    await expect(
      model.listContentCatalog(targetUserId, {
        endAt: new Date('2026-09-01T00:00:00.000Z'),
        kind: 'generation',
        startAt: new Date('2026-09-02T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/time range/i);
  });
});
