import { describe, expect, it } from 'vitest';

import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

describe('travel orchestration upgrade contract', () => {
  it.each([
    ['copy', 'default-travel-copywriter', 'copy-agent', '请写旅游文案'],
    ['image', 'default-travel-image-designer', 'image-agent', '请生成旅游图片'],
    ['video', 'default-travel-video-producer', 'video-agent', '请生成旅游视频'],
    ['document', 'default-travel-document-assistant', 'document-agent', '请制作旅游文档'],
  ] as const)('locks the %s template clientId to %s', (intent, clientId, memberId, message) => {
    const route = routeTravelRequest({ members, message });

    expect(route, `${intent} template clientId drifted from ${clientId}`).toEqual({
      intents: [intent],
      memberIds: [memberId],
      mode: 'delegate',
    });
  });

  it('locks canonical intent and member dispatch order', () => {
    const route = routeTravelRequest({
      members,
      message: '请制作文档、视频、图片和文案',
    });

    expect(route, 'canonical intent order must remain copy, image, video, document').toEqual({
      intents: ['copy', 'image', 'video', 'document'],
      memberIds: ['copy-agent', 'image-agent', 'video-agent', 'document-agent'],
      mode: 'delegate',
    });
  });

  it('locks finishAfterSteps for the supervisor and every member policy', () => {
    const result = createTravelToolDispatchPolicy({
      members,
      message: '写文案、生成图片、制作视频并整理文档',
    });
    expect(result.mode, 'finishAfterSteps contract requires a delegate policy').toBe('delegate');
    if (result.mode !== 'delegate') throw new Error('expected delegate policy');

    expect(result.policy.finishAfterSteps, 'supervisor policy must close after its steps').toBe(
      true,
    );
    for (const step of result.policy.steps) {
      const { agentId } = JSON.parse(step.arguments);
      expect(
        step.memberToolDispatchPolicies?.[agentId]?.finishAfterSteps,
        `member policy for ${agentId} must close after its steps`,
      ).toBe(true);
    }
  });

  it('locks controlled production apiName values by specialist', () => {
    const result = createTravelToolDispatchPolicy({
      members,
      message: '写文案、生成图片、制作视频并整理文档',
    });
    expect(result.mode, 'controlled apiName contract requires a delegate policy').toBe('delegate');
    if (result.mode !== 'delegate') throw new Error('expected delegate policy');

    const apiNamesByMember = Object.fromEntries(
      result.policy.steps.map((step) => {
        const { agentId } = JSON.parse(step.arguments);
        const memberSteps = step.memberToolDispatchPolicies?.[agentId]?.steps || [];
        return [agentId, memberSteps.map(({ apiName }) => apiName)];
      }),
    );

    expect(apiNamesByMember, 'controlled production apiName contract drifted').toEqual({
      'copy-agent': ['generateCopy'],
      'document-agent': ['generateDocument'],
      'image-agent': ['generateImage'],
      'video-agent': ['generateVideo'],
    });
  });
});
