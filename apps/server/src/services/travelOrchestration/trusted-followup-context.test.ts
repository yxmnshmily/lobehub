import { describe, expect, it } from 'vitest';

import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

describe('trusted previous-turn intent context', () => {
  it.each([
    ['继续', ['copy'], ['copy'], ['copy-agent']],
    ['再来一版', ['image'], ['image'], ['image-agent']],
    ['改短一点', ['video'], ['video'], ['video-agent']],
    ['换个风格', ['document'], ['document'], ['document-agent']],
  ] as const)(
    'inherits a confirmed intent for the referential follow-up %s',
    (message, confirmedIntents, intents, memberIds) => {
      expect(routeTravelRequest({ members, message, previousTurn: { confirmedIntents } })).toEqual({
        intents,
        memberIds,
        mode: 'delegate',
      });
    },
  );

  it('deduplicates and canonicalizes a trusted mixed-intent context', () => {
    expect(
      routeTravelRequest({
        members,
        message: '继续',
        previousTurn: {
          confirmedIntents: ['document', 'image', 'copy', 'video', 'image'],
          taskStatus: 'succeeded',
        },
      }),
    ).toEqual({
      intents: ['copy', 'image', 'video', 'document'],
      memberIds: ['copy-agent', 'image-agent', 'video-agent', 'document-agent'],
      mode: 'delegate',
    });
  });

  it.each(['queued', 'running', 'pending', 'succeeded', 'failed', 'unavailable'] as const)(
    'accepts the known previous task status %s without changing the confirmed intent',
    (taskStatus) => {
      expect(
        routeTravelRequest({
          members,
          message: '再来一版',
          previousTurn: { confirmedIntents: ['image'], taskStatus },
        }),
      ).toEqual({ intents: ['image'], memberIds: ['image-agent'], mode: 'delegate' });
    },
  );

  it.each([
    ['生成一张新封面', ['copy', 'document'], ['image'], ['image-agent']],
    ['写一段旅游文案', ['image', 'video'], ['copy'], ['copy-agent']],
    ['不要文案，只生成图片', ['copy', 'document'], ['image'], ['image-agent']],
    ['继续完善行程文档', ['image'], ['document'], ['document-agent']],
  ] as const)(
    'lets the new explicit intent override prior context for %s',
    (message, confirmedIntents, intents, memberIds) => {
      expect(routeTravelRequest({ members, message, previousTurn: { confirmedIntents } })).toEqual({
        intents,
        memberIds,
        mode: 'delegate',
      });
    },
  );

  it.each([
    ['不要继续', 'unknown-intent'],
    ['不用了', 'unknown-intent'],
    ['别再改了', 'unknown-intent'],
    ['停止制作', 'unknown-intent'],
    ['只查看上一版', 'unknown-intent'],
    ['打开看看', 'unknown-intent'],
    ['换个话题聊酒店价格', 'safe-informational'],
  ] as const)(
    'does not inherit for negation, viewing, or a topic change: %s',
    (message, reason) => {
      expect(
        routeTravelRequest({ members, message, previousTurn: { confirmedIntents: ['copy'] } }),
      ).toEqual({ intents: [], memberIds: [], mode: 'supervisor-fallback', reason });
    },
  );

  it.each([
    ['', { confirmedIntents: ['copy'] }, 'unknown-intent'],
    ['   \n\t', { confirmedIntents: ['copy'] }, 'unknown-intent'],
    [`${'请'.repeat(600)}继续`, { confirmedIntents: ['copy'] }, 'unknown-intent'],
    ['继续', { confirmedIntents: [] }, 'policy-denied'],
    ['继续', { confirmedIntents: ['copy', 'unknown-intent'] }, 'policy-denied'],
    ['继续', { confirmedIntents: 'copy' }, 'policy-denied'],
    ['继续', { confirmedIntents: ['copy'], taskStatus: 'private-status' }, 'policy-denied'],
    ['继续', { confirmedIntents: ['copy'], historyText: '上一轮的原始用户正文' }, 'policy-denied'],
    ['继续', { confirmedIntents: ['copy'], userId: 'private-user-id' }, 'policy-denied'],
    [
      '继续',
      {
        billing: { balance: 1 },
        confirmedIntents: ['copy'],
        model: 'private-model',
        provider: 'private-provider',
      },
      'policy-denied',
    ],
  ] as const)(
    'rejects empty, oversized, or forged context for message %j',
    (message, previousTurn, reason) => {
      expect(routeTravelRequest({ members, message, previousTurn: previousTurn as any })).toEqual({
        intents: [],
        memberIds: [],
        mode: 'supervisor-fallback',
        reason,
      });
    },
  );

  it('fails closed when an inherited mixed intent is missing any specialist', () => {
    expect(
      routeTravelRequest({
        members: members.filter(({ id }) => id !== 'video-agent'),
        message: '继续',
        previousTurn: { confirmedIntents: ['video', 'copy'] },
      }),
    ).toEqual({
      error: {
        code: 'TRAVEL_SPECIALIST_UNAVAILABLE',
        message: '对应的旅游制作助理尚未配置，请先由管理员完成群成员配置。',
      },
      intents: ['copy', 'video'],
      memberIds: [],
      mode: 'unavailable',
    });
  });

  it('dispatches inherited specialists without copying trusted context into tool arguments', () => {
    const result = createTravelToolDispatchPolicy({
      members,
      message: '再来一版',
      previousTurn: { confirmedIntents: ['image'], taskStatus: 'succeeded' },
    });

    expect(result.mode).toBe('delegate');
    if (result.mode !== 'delegate') throw new Error('expected delegated follow-up');
    const supervisorArguments = JSON.parse(result.policy.steps[0].arguments);
    const memberPolicy = result.policy.steps[0].memberToolDispatchPolicies?.['image-agent'];
    const memberArguments = JSON.parse(memberPolicy?.steps[0].arguments || '{}');
    expect(supervisorArguments).toEqual({
      agentId: 'image-agent',
      instruction: '再来一版',
      skipCallSupervisor: false,
    });
    expect(memberArguments).toEqual({ prompt: '再来一版' });
    expect(JSON.stringify(result.policy)).not.toContain('succeeded');
    expect(JSON.stringify(result.policy)).not.toContain('confirmedIntents');
  });
});
