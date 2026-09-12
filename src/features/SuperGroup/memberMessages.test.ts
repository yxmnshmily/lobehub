import { describe, expect, it } from 'vitest';

import { toConversationMessages } from './memberMessages';

describe('membership-scoped messages in the original conversation renderer', () => {
  it('feeds the canonical tool chain and works into the existing renderer without converting tools to users', () => {
    const tools = [
      {
        id: 'call-1',
        type: 'builtin' as const,
        apiName: 'createDocument',
        identifier: 'lobe-notebook',
        arguments: '{}',
      },
    ];
    const chain = [
      { id: 'step', role: 'assistant' as const, content: '', tools, createdAt: 1, updatedAt: 3 },
      {
        id: 'result',
        role: 'tool' as const,
        content: 'created',
        tool_call_id: 'call-1',
        createdAt: 2,
        updatedAt: 3,
      },
      {
        id: 'final',
        role: 'assistant' as const,
        content: '完成',
        metadata: { work: { rootOperationId: 'op' } },
        works: [],
        createdAt: 3,
        updatedAt: 3,
      },
    ];
    const result = toConversationMessages('group', undefined, [
      {
        id: 'final',
        content: '完成',
        kind: 'assistant',
        visibleAt: new Date(3),
        executionMessages: chain,
      },
    ]);
    expect(result.map((message) => message.role)).toEqual(['assistant', 'tool', 'assistant']);
    expect(result[0].tools).toEqual(tools);
    expect(result[1].tool_call_id).toBe('call-1');
    expect(result[2].metadata?.work?.rootOperationId).toBe('op');
    expect(result[2].works).toEqual([]);
  });
  it('keeps shared attachments in the standard message renderer', () => {
    const [message] = toConversationMessages('g', 't', [
      {
        content: '附件',
        id: 'public-attachment',
        kind: 'member',
        visibleAt: new Date(),
        fileList: [
          {
            id: 'f',
            name: '行程.pdf',
            size: 120,
            fileType: 'application/pdf',
            url: '/shared/file',
            downloadUrl: '/shared/download',
          },
        ],
        imageList: [{ id: 'i', alt: '路线图', url: '/shared/image' }],
      },
    ]);
    expect(message.fileList?.[0]).toMatchObject({
      id: 'f',
      name: '行程.pdf',
      downloadUrl: '/shared/download',
    });
    expect(message.imageList).toEqual([{ id: 'i', alt: '路线图', url: '/shared/image' }]);
  });
  it('preserves each authorized human sender instead of merging all members', () => {
    const rows = toConversationMessages('group', undefined, [
      {
        id: 'a',
        content: '你好',
        kind: 'member',
        visibleAt: new Date(),
        sender: { id: 'group-person-a', fullName: '小王', avatar: '/a.png' },
      },
      {
        id: 'b',
        content: '收到',
        kind: 'member',
        visibleAt: new Date(),
        sender: { id: 'group-person-b', fullName: '小李', avatar: '/b.png' },
      },
    ]);
    expect(rows[0].sender).toEqual({ id: 'group-person-a', fullName: '小王', avatar: '/a.png' });
    expect(rows[1].sender).toEqual({ id: 'group-person-b', fullName: '小李', avatar: '/b.png' });
  });
  it('preserves the actual published assistant and its supervisor designation', () => {
    const [message] = toConversationMessages(
      'g',
      't',
      [
        {
          id: 'm',
          agentId: 'host',
          content: '结果',
          kind: 'assistant',
          visibleAt: new Date(),
          topicId: 't',
        },
      ],
      [{ id: 'host', isSupervisor: true }],
    );
    expect(message.agentId).toBe('host');
    expect(message.metadata?.isSupervisor).toBe(true);
    const [unknown] = toConversationMessages(
      'g',
      't',
      [{ id: 'x', content: '旧消息', kind: 'assistant', visibleAt: new Date() }],
      [{ id: 'host', isSupervisor: true }],
    );
    expect(unknown.metadata?.isSupervisor).not.toBe(true);
  });
  it('preserves group, topic and public message identity without inventing owner permissions', () => {
    const messages = toConversationMessages('group-owner', 'topic-existing', [
      { content: '**计划**', id: 'public-1', kind: 'owner', visibleAt: new Date(1000) },
      {
        content: '回复',
        id: 'published-1',
        topicId: 'topic-existing',
        kind: 'assistant',
        visibleAt: new Date(2000),
      },
    ]);
    expect(messages[0]).toMatchObject({
      content: '**计划**',
      id: 'public-1',
      groupId: 'group-owner',
      topicId: 'topic-existing',
      role: 'user',
      createdAt: 1000,
    });
    expect(messages[1]).toMatchObject({
      id: 'published-1',
      topicId: 'topic-existing',
      role: 'assistant',
    });
    expect(messages[0].sender?.fullName).toBe('群主');
    expect(messages[0].agentId).toBeUndefined();
  });
  it('keeps all authorized topics in the same joined-group timeline', () => {
    const rows = [
      { content: '甲', id: 'a', topicId: 'topic-a', kind: 'owner', visibleAt: new Date(1000) },
      { content: '乙', id: 'b', topicId: 'topic-b', kind: 'assistant', visibleAt: new Date(2000) },
    ];
    expect(toConversationMessages('joined', 'topic-a', rows).map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
    expect(toConversationMessages('joined', 'topic-b', rows).map((row) => row.id)).toEqual([
      'a',
      'b',
    ]);
  });
});
