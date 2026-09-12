/** @vitest-environment node */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { groupMemberCallback } from '@/server/router-hono/agent/handlers/groupMemberCallback';

import { AgentRuntimeService } from './AgentRuntimeService';
import type { GroupActionMemberBridgeParams } from './types';

const callbackDeps = vi.hoisted(() => ({
  completeGroupActionMember: vi.fn(),
  getOperationMetadata: vi.fn(),
}));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(() => ({
    completeGroupActionMember: callbackDeps.completeGroupActionMember,
  })),
}));

// Keep the real completion bridge and message normalization. No constructor,
// model execution, database connection, or queue delivery is needed here.
vi.mock('@lobechat/model-runtime', () => ({
  applyModelExtendParams: vi.fn(() => ({})),
  getModelPropertyWithFallback: vi.fn(),
  ERROR_CODE_SPECS: {},
  getErrorCodeSpec: () => undefined,
  refineErrorCode: () => undefined,
}));
vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: vi.fn() }));
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn(),
  getTrustedClientTokenForSession: vi.fn(),
  isTrustedClientEnabled: () => false,
}));
vi.mock('@/server/modules/ModelRuntime', () => ({
  initializeRuntimeOptions: vi.fn(),
  ApiKeyManager: vi.fn(),
}));
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn(() => ({
    getOperationMetadata: callbackDeps.getOperationMetadata,
  })),
  createStreamEventManager: vi.fn(),
}));
vi.mock('@/server/modules/AgentRuntime/RuntimeExecutors', () => ({
  createRuntimeExecutors: vi.fn(),
}));
vi.mock('@/server/services/search', () => ({ SearchService: vi.fn(), searchService: {} }));
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn(),
  serverMessagesEngine: vi.fn(),
}));

const createFixture = () => {
  const update = vi.fn().mockResolvedValue({ success: true });
  const updateToolMessage = vi.fn().mockResolvedValue({ success: true });
  const resume = vi.fn().mockResolvedValue(true);
  const service = Object.assign(Object.create(AgentRuntimeService.prototype), {
    messageModel: { update, updateToolMessage },
    tryResumeParentFromAsyncTool: resume,
  }) as AgentRuntimeService;
  const params: GroupActionMemberBridgeParams = {
    anchorMessageId: 'group-tool',
    expectedMembers: 1,
    finalState: {
      messages: [{ id: 'review-message', content: '请补充亲子互动的画面。', role: 'assistant' }],
      metadata: { agentId: 'reviewer' },
      status: 'done',
    } as GroupActionMemberBridgeParams['finalState'],
    groupToolMessageId: 'group-tool',
    mode: 'in_group',
    onComplete: 'resume',
    operationId: 'review-operation',
    parentOperationId: 'supervisor-operation',
    reason: 'done',
    replyToMessageId: 'author_draft',
  };
  return { params, resume, service, update, updateToolMessage };
};

describe('group reply persistence barrier', () => {
  it('does not publish a completion receipt or resume when the quote update returns false', async () => {
    const { params, resume, service, update, updateToolMessage } = createFixture();
    update.mockResolvedValue({ success: false });

    await expect(service.completeGroupActionMember(params)).rejects.toThrow();

    expect(updateToolMessage).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('allows redelivery to persist the quote before publishing the receipt and resuming', async () => {
    const { params, resume, service, update, updateToolMessage } = createFixture();
    update.mockResolvedValueOnce({ success: false });

    await expect(service.completeGroupActionMember(params)).rejects.toThrow();
    await expect(service.completeGroupActionMember(params)).resolves.toBe(true);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('review-message', {
      content: '<group_reply ref="author%5Fdraft" />\n请补充亲子互动的画面。',
    });
    expect(updateToolMessage).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(update.mock.invocationCallOrder[1]).toBeLessThan(
      updateToolMessage.mock.invocationCallOrder[0],
    );
    expect(updateToolMessage.mock.invocationCallOrder[0]).toBeLessThan(
      resume.mock.invocationCallOrder[0],
    );
  });

  it('does not rewrite an already persisted canonical quote on redelivery', async () => {
    const { params, resume, service, update, updateToolMessage } = createFixture();
    params.finalState!.messages[0].content =
      '<group_reply ref="author%5Fdraft" />\n请补充亲子互动的画面。';

    await expect(service.completeGroupActionMember(params)).resolves.toBe(true);

    expect(update).not.toHaveBeenCalled();
    expect(updateToolMessage).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe('group reply HTTP completion callback', () => {
  beforeEach(() => {
    callbackDeps.completeGroupActionMember.mockReset();
    callbackDeps.getOperationMetadata.mockReset().mockResolvedValue({
      userId: 'group-owner',
      workspaceId: 'group-workspace',
    });
  });

  it('returns 500 on failed persistence, then 200 when the same callback is redelivered successfully', async () => {
    const { params, resume, service, update, updateToolMessage } = createFixture();
    // Redis snapshots omit messages. Recover the final leaf through the real
    // group-scoped query + conversation-flow path, not an in-process snapshot.
    const loadAgentState = vi.fn().mockResolvedValue({
      metadata: { agentId: 'reviewer', groupId: 'work-group', topicId: 'review-topic' },
      status: 'done',
    });
    const query = vi.fn().mockResolvedValue([
      { content: '审核文案', createdAt: 1, id: 'request-message', role: 'user', updatedAt: 1 },
      {
        content: '请补充亲子互动的画面。',
        createdAt: 2,
        id: 'review-message',
        parentId: 'request-message',
        role: 'assistant',
        updatedAt: 2,
      },
    ]);
    Object.assign(service, {
      coordinator: { loadAgentState },
      messageModel: { query, update, updateToolMessage },
    });
    callbackDeps.completeGroupActionMember.mockImplementation((input) =>
      service.completeGroupActionMember(input),
    );
    update.mockResolvedValueOnce({ success: false });

    const app = new Hono().post('/callback', groupMemberCallback);
    const { finalState: _finalState, ...body } = params;
    const deliver = () =>
      app.request('/callback', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failed = await deliver();
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: expect.stringContaining('review-message') });
      expect(updateToolMessage).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();

      const retried = await deliver();
      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual({
        operationId: 'review-operation',
        parentOperationId: 'supervisor-operation',
        resumed: true,
        success: true,
      });
      expect(loadAgentState).toHaveBeenCalledTimes(2);
      expect(loadAgentState).toHaveBeenLastCalledWith('review-operation');
      expect(query).toHaveBeenCalledTimes(2);
      expect(query).toHaveBeenLastCalledWith(
        {
          agentId: 'reviewer',
          groupId: 'work-group',
          threadId: undefined,
          topicId: 'review-topic',
        },
        expect.objectContaining({ allowShareVisitor: true }),
      );
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith('review-message', {
        content: '<group_reply ref="author%5Fdraft" />\n请补充亲子互动的画面。',
      });
      expect(updateToolMessage).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });
});
