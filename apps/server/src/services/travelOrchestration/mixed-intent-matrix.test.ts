import { describe, expect, it } from 'vitest';

import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const mixedIntentMatrix = [
  {
    intents: ['copy', 'image'],
    label: 'copy+image',
    memberIds: ['copy-agent', 'image-agent'],
    message: '生成旅游图片图片，并写两版文案文案',
    missingClientIds: ['default-travel-copywriter', 'default-travel-image-designer'],
    negatedNoise: '不要生成视频',
  },
  {
    intents: ['copy', 'video'],
    label: 'copy+video',
    memberIds: ['copy-agent', 'video-agent'],
    message: '制作旅游视频视频，并写旅游文案文案',
    missingClientIds: ['default-travel-copywriter', 'default-travel-video-producer'],
    negatedNoise: '不要制作文档',
  },
  {
    intents: ['copy', 'document'],
    label: 'copy+document',
    memberIds: ['copy-agent', 'document-agent'],
    message: '整理旅游文档文档，并写旅游文案文案',
    missingClientIds: ['default-travel-copywriter', 'default-travel-document-assistant'],
    negatedNoise: '不要生成图片',
  },
  {
    intents: ['image', 'video'],
    label: 'image+video',
    memberIds: ['image-agent', 'video-agent'],
    message: '制作旅游视频视频，并生成旅游图片图片',
    missingClientIds: ['default-travel-image-designer', 'default-travel-video-producer'],
    negatedNoise: '不要写文案',
  },
  {
    intents: ['image', 'document'],
    label: 'image+document',
    memberIds: ['image-agent', 'document-agent'],
    message: '整理旅游文档文档，并生成旅游图片图片',
    missingClientIds: ['default-travel-image-designer', 'default-travel-document-assistant'],
    negatedNoise: '不要生成视频',
  },
  {
    intents: ['video', 'document'],
    label: 'video+document',
    memberIds: ['video-agent', 'document-agent'],
    message: '整理旅游文档文档，并制作旅游视频视频',
    missingClientIds: ['default-travel-video-producer', 'default-travel-document-assistant'],
    negatedNoise: '不要生成图片',
  },
  {
    intents: ['copy', 'image', 'video'],
    label: 'copy+image+video',
    memberIds: ['copy-agent', 'image-agent', 'video-agent'],
    message: '制作视频视频、生成图片图片、写文案文案',
    missingClientIds: [
      'default-travel-copywriter',
      'default-travel-image-designer',
      'default-travel-video-producer',
    ],
    negatedNoise: '不要制作文档',
  },
  {
    intents: ['copy', 'image', 'document'],
    label: 'copy+image+document',
    memberIds: ['copy-agent', 'image-agent', 'document-agent'],
    message: '整理文档文档、生成图片图片、写文案文案',
    missingClientIds: [
      'default-travel-copywriter',
      'default-travel-image-designer',
      'default-travel-document-assistant',
    ],
    negatedNoise: '不要生成视频',
  },
  {
    intents: ['copy', 'video', 'document'],
    label: 'copy+video+document',
    memberIds: ['copy-agent', 'video-agent', 'document-agent'],
    message: '整理文档文档、制作视频视频、写文案文案',
    missingClientIds: [
      'default-travel-copywriter',
      'default-travel-video-producer',
      'default-travel-document-assistant',
    ],
    negatedNoise: '不要生成图片',
  },
  {
    intents: ['image', 'video', 'document'],
    label: 'image+video+document',
    memberIds: ['image-agent', 'video-agent', 'document-agent'],
    message: '整理文档文档、制作视频视频、生成图片图片',
    missingClientIds: [
      'default-travel-image-designer',
      'default-travel-video-producer',
      'default-travel-document-assistant',
    ],
    negatedNoise: '不要写文案',
  },
  {
    intents: ['copy', 'image', 'video', 'document'],
    label: 'copy+image+video+document',
    memberIds: ['copy-agent', 'image-agent', 'video-agent', 'document-agent'],
    message: '整理文档文档、制作视频视频、生成图片图片、写文案文案',
    missingClientIds: [
      'default-travel-copywriter',
      'default-travel-image-designer',
      'default-travel-video-producer',
      'default-travel-document-assistant',
    ],
    negatedNoise: '',
  },
] as const;

const expectedApiNamesByMember: Record<string, string[]> = {
  'copy-agent': [],
  'document-agent': ['generateDocument'],
  'image-agent': ['generateImage'],
  'video-agent': ['generateVideo'],
};

describe('travel orchestration exhaustive mixed-intent matrix', () => {
  it.each(mixedIntentMatrix)(
    'routes $label once per intent in canonical order',
    ({ intents, memberIds, message }) => {
      expect(routeTravelRequest({ members, message })).toEqual({
        intents,
        memberIds,
        mode: 'delegate',
      });
    },
  );

  it.each(mixedIntentMatrix)(
    'keeps negated and quoted, code, or URL pseudo-intents out of $label',
    ({ intents, memberIds, message, negatedNoise }) => {
      const hostileMessage = [
        message,
        negatedNoise,
        '引用内容：“写文案、生成图片、制作视频并整理文档”',
        '```\n写文案、生成图片、制作视频并整理文档\n```',
        '资料：https://example.com/写文案生成图片制作视频整理文档',
      ]
        .filter(Boolean)
        .join('\n');

      expect(routeTravelRequest({ members, message: hostileMessage })).toEqual({
        intents,
        memberIds,
        mode: 'delegate',
      });
    },
  );

  it.each(mixedIntentMatrix)(
    'fails all of $label closed when any required member is missing',
    ({ intents, message, missingClientIds }) => {
      for (const missingClientId of missingClientIds) {
        const availableMembers = members.filter(({ clientId }) => clientId !== missingClientId);

        expect(
          routeTravelRequest({ members: availableMembers, message }),
          `${missingClientId} was missing but the request did not fail closed`,
        ).toEqual({
          error: {
            code: 'TRAVEL_SPECIALIST_UNAVAILABLE',
            message: '对应的旅游制作助理尚未配置，请先由管理员完成群成员配置。',
          },
          intents,
          memberIds: [],
          mode: 'unavailable',
        });
      }
    },
  );

  it.each(mixedIntentMatrix)(
    'keeps $label policies closed and production apiName values isolated',
    ({ intents, memberIds, message }) => {
      const result = createTravelToolDispatchPolicy({ members, message });
      expect(result.mode).toBe('delegate');
      if (result.mode !== 'delegate') throw new Error('expected delegate policy');

      expect(result.policy.finishAfterSteps).toBe(true);
      expect(result.policy.steps).toHaveLength(intents.length);

      const dispatchedMemberIds = result.policy.steps.map((step) => {
        expect(step.apiName).toBe('speak');
        const { agentId } = JSON.parse(step.arguments);
        const memberPolicy = step.memberToolDispatchPolicies?.[agentId];

        expect(memberPolicy?.finishAfterSteps).toBe(true);
        expect(memberPolicy?.steps.map(({ apiName }) => apiName)).toEqual(
          expectedApiNamesByMember[agentId],
        );
        return agentId;
      });

      expect(dispatchedMemberIds).toEqual(memberIds);
      expect(new Set(dispatchedMemberIds).size).toBe(intents.length);
    },
  );
});
