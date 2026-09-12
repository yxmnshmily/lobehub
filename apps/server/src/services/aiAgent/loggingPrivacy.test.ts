import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logDeviceToolAudit } from './deviceToolAudit';
import { createSubAgentBridgeHook } from './hooks/threadRunHooks';
import { ingestAttachment } from './ingestAttachment';
import { aiAgentDebug } from './safeDebug';

const debugLog = vi.hoisted(() => vi.fn());

vi.mock('debug', () => ({ default: () => debugLog }));

describe('AI agent diagnostic privacy', () => {
  beforeEach(() => debugLog.mockClear());

  it('reduces AI agent log fields to numeric metrics', () => {
    aiAgentDebug('execAgent: failed with %O for %s', new Error('sk-private-error'), 'user-private');

    expect(debugLog).toHaveBeenCalledWith('ai_agent.execution.error', 1, 1);
    expect(JSON.stringify(debugLog.mock.calls)).not.toMatch(/sk-private-error|user-private/);
  });

  it('does not report preparation or delegation as terminal success', () => {
    aiAgentDebug('execAgent: creating operation %s', 'operation-private');
    aiAgentDebug('execAgentMember: delegated to execAgent');
    aiAgentDebug('execAgent: created operation %s', 'operation-private');

    expect(debugLog.mock.calls).toEqual([
      ['ai_agent.lifecycle', 1],
      ['ai_agent.lifecycle'],
      ['ai_agent.operation.created', 1],
    ]);
  });

  it('hashes device audit identity fields while retaining the decision', () => {
    logDeviceToolAudit({
      apiName: 'read_file',
      botContext: {
        isOwner: false,
        platform: 'telegram',
        senderExternalUserId: 'sender-private',
      } as any,
      canUseDevice: false,
      operationId: 'operation-private',
      reason: 'external-sender-denied',
      toolIdentifier: 'lobe-local-system',
      topicId: 'topic-private',
      userId: 'user-private',
    });

    const output = JSON.stringify(debugLog.mock.calls);
    expect(output).not.toMatch(/sender-private|operation-private|topic-private|user-private/);
    expect(output).toContain('external-sender-denied');
  });

  it('does not log attachment names, storage keys, URLs, or raw failures', async () => {
    const fileService = {
      getFileAccessUrl: vi.fn(),
      uploadFromBuffer: vi.fn().mockResolvedValue({
        fileId: 'file-private',
        key: 'storage-private-key',
      }),
    };

    await ingestAttachment(
      {
        buffer: Buffer.from('safe content'),
        mimeType: 'text/plain',
        name: 'passenger@example.com-private.txt',
      },
      fileService as any,
      'user-private',
    );

    expect(JSON.stringify(debugLog.mock.calls)).not.toMatch(
      /passenger@example\.com|storage-private-key|file-private|user-private/,
    );
  });

  it('keeps a safe operational breadcrumb when a sub-agent bridge fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const maliciousError = 'provider=private passenger@example.com token=private-token';
    const hook = createSubAgentBridgeHook(
      {
        completeSubAgentBridge: vi.fn().mockRejectedValue(new Error(maliciousError)),
      } as any,
      'parent-private',
      'tool-private',
      'thread-private',
    );

    try {
      await hook.handler!({ operationId: 'operation-private' } as any);
      expect(consoleError).toHaveBeenCalledWith('ai_agent.bridge.subagent.error');
      expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(
        /provider=private|passenger@example\.com|private-token|parent-private|thread-private/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
