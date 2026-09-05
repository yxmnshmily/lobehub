import { describe, expect, it } from 'vitest';

import { createTravelToolDispatchPolicy, routeTravelRequest } from './index';

const supervisorId = 'travel-supervisor';
const members = [
  { clientId: 'default-travel-supervisor', id: supervisorId },
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const publicVisitorContracts = [
  // Copy.
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '帮我写一段桂林旅游文案',
    mode: 'delegate',
  },
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '写一段画面感强的文案',
    mode: 'delegate',
  },
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '写一条小红书旅游推文',
    mode: 'delegate',
  },
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '给这条线路写抖音口播',
    mode: 'delegate',
  },

  // Image.
  {
    intents: ['image'],
    memberIds: ['image-agent'],
    message: '生成一张川西旅游封面',
    mode: 'delegate',
  },
  {
    intents: ['image'],
    memberIds: ['image-agent'],
    message: '制作一张亲子游海报',
    mode: 'delegate',
  },
  {
    intents: ['image'],
    memberIds: ['image-agent'],
    message: '给线路生成一张配图',
    mode: 'delegate',
  },
  {
    intents: ['image'],
    memberIds: ['image-agent'],
    message: '参考附件里的图片生成新封面',
    mode: 'delegate',
  },

  // Video.
  {
    intents: ['video'],
    memberIds: ['video-agent'],
    message: '制作一条云南旅游短视频',
    mode: 'delegate',
  },
  {
    intents: ['video'],
    memberIds: ['video-agent'],
    message: '把采访素材剪成 15 秒视频',
    mode: 'delegate',
  },
  {
    intents: ['video'],
    memberIds: ['video-agent'],
    message: '输出一条景区宣传成片',
    mode: 'delegate',
  },
  {
    intents: ['video'],
    memberIds: ['video-agent'],
    message: '上传现有视频后制作新短视频',
    mode: 'delegate',
  },

  // Document.
  {
    intents: ['document'],
    memberIds: ['document-agent'],
    message: '整理成 Word 行程文档',
    mode: 'delegate',
  },
  {
    intents: ['document'],
    memberIds: ['document-agent'],
    message: '导出一份 PDF 旅游方案',
    mode: 'delegate',
  },
  {
    intents: ['document'],
    memberIds: ['document-agent'],
    message: '生成一份四川五日行程单',
    mode: 'delegate',
  },
  {
    intents: ['document'],
    memberIds: ['document-agent'],
    message: '制作一份团队报价单',
    mode: 'delegate',
  },

  // Mixed requests must use canonical order, not wording order.
  {
    intents: ['copy', 'image'],
    memberIds: ['copy-agent', 'image-agent'],
    message: '先生成封面，再写宣传文案',
    mode: 'delegate',
  },
  {
    intents: ['image', 'video'],
    memberIds: ['image-agent', 'video-agent'],
    message: '制作短视频并生成封面',
    mode: 'delegate',
  },
  {
    intents: ['copy', 'document'],
    memberIds: ['copy-agent', 'document-agent'],
    message: '导出 PDF 方案并写小红书文案',
    mode: 'delegate',
  },
  {
    intents: ['copy', 'image', 'video', 'document'],
    memberIds: ['copy-agent', 'image-agent', 'video-agent', 'document-agent'],
    message: '整理 Word、制作视频、生成封面并写文案',
    mode: 'delegate',
  },

  // Natural follow-up edits expressed entirely in the current message.
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '把上面的文案改短一点',
    mode: 'delegate',
  },
  {
    intents: ['image'],
    memberIds: ['image-agent'],
    message: '把刚才的封面改成竖版',
    mode: 'delegate',
  },
  {
    intents: ['document'],
    memberIds: ['document-agent'],
    message: '把上面的行程整理成表格',
    mode: 'delegate',
  },
  {
    intents: ['video'],
    memberIds: ['video-agent'],
    message: '给刚才的视频加上字幕',
    mode: 'delegate',
  },

  // Negation and view-only wording.
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '不要改图，只把文案改短',
    mode: 'delegate',
  },
  { intents: [], memberIds: [], message: '只看视频，不制作视频', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '只查看图片，不生成图片', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '只阅读文档，不制作文档', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '分析这张封面，不要生成', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '我只想看视频制作教程', mode: 'supervisor-fallback' },

  // Attachment references remain inputs, not additional production intents.
  {
    intents: ['copy'],
    memberIds: ['copy-agent'],
    message: '附件名：封面视频方案.pdf，请写文案',
    mode: 'delegate',
  },
  {
    intents: ['image'],
    memberIds: ['image-agent'],
    message: '附件：视频文档.docx；请生成封面',
    mode: 'delegate',
  },
  {
    intents: ['video'],
    memberIds: ['video-agent'],
    message: '上传附件后制作一条旅游短视频',
    mode: 'delegate',
  },
  {
    intents: ['document'],
    memberIds: ['document-agent'],
    message: '把附件里的路线整理成 PDF 文档',
    mode: 'delegate',
  },

  // Ambiguous platform or reference wording remains with the supervisor.
  {
    intents: [],
    memberIds: [],
    message: '想了解旅行社视频号怎么运营',
    mode: 'supervisor-fallback',
  },
  { intents: [], memberIds: [], message: '对比几个旅游视频平台', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '图片链接在哪里', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '帮我看看这组图文数据', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '打开 PDF 看看内容', mode: 'supervisor-fallback' },
  { intents: [], memberIds: [], message: '这条路线预算大概多少', mode: 'supervisor-fallback' },
] as const;

const safeInformationalMessages = new Set([
  '只看视频，不制作视频',
  '只查看图片，不生成图片',
  '只阅读文档，不制作文档',
  '分析这张封面，不要生成',
  '我只想看视频制作教程',
  '想了解旅行社视频号怎么运营',
  '对比几个旅游视频平台',
  '图片链接在哪里',
  '帮我看看这组图文数据',
  '打开 PDF 看看内容',
  '这条路线预算大概多少',
]);

describe('public website visitor to travel supervisor contract', () => {
  it('keeps a substantial public wording contract without personal data', () => {
    expect(publicVisitorContracts).toHaveLength(40);
  });

  it.each(publicVisitorContracts)(
    'routes public wording without exposing the supervisor as a member: $message',
    ({ intents, memberIds, message, mode }) => {
      const route = routeTravelRequest({ members, message });
      const expectedRoute =
        mode === 'delegate'
          ? { intents, memberIds, mode }
          : {
              intents,
              memberIds,
              mode,
              reason: safeInformationalMessages.has(message)
                ? 'safe-informational'
                : 'unknown-intent',
            };
      expect(route).toEqual(expectedRoute);

      const dispatch = createTravelToolDispatchPolicy({ members, message });
      expect(dispatch.mode).toBe(mode);
      if (dispatch.mode !== 'delegate') return;

      const dispatchedMemberIds = dispatch.policy.steps.map(
        ({ arguments: serializedArguments }) => JSON.parse(serializedArguments).agentId,
      );
      expect(dispatchedMemberIds).toEqual(memberIds);
      expect(dispatchedMemberIds).not.toContain(supervisorId);
    },
  );

  it('does not treat the supervisor or a same-title custom member as a production specialist', () => {
    const nonSpecialistMembers = [
      { clientId: 'default-travel-supervisor', id: supervisorId },
      { clientId: 'custom-visitor-helper', id: 'custom-helper', title: '旅游视频专员' },
    ];

    expect(
      routeTravelRequest({ members: nonSpecialistMembers, message: '制作旅游视频' }),
    ).toMatchObject({
      intents: ['video'],
      memberIds: [],
      mode: 'unavailable',
    });
  });

  it('keeps an ambiguous request with only the supervisor in supervisor fallback', () => {
    expect(
      routeTravelRequest({
        members: [{ clientId: 'default-travel-supervisor', id: supervisorId }],
        message: '这条旅游路线预算够不够',
      }),
    ).toEqual({
      intents: [],
      memberIds: [],
      mode: 'supervisor-fallback',
      reason: 'safe-informational',
    });
  });

  it.each([
    ['写文案', 'default-travel-copywriter', ['copy']],
    ['生成封面', 'default-travel-image-designer', ['image']],
    ['制作视频', 'default-travel-video-producer', ['video']],
    ['导出行程单', 'default-travel-document-assistant', ['document']],
    [
      '写文案、生成封面、制作视频并导出行程单',
      'default-travel-video-producer',
      ['copy', 'image', 'video', 'document'],
    ],
  ] as const)(
    'fails the complete public request closed when %s lacks %s',
    (message, missingClientId, intents) => {
      const availableMembers = members.filter(({ clientId }) => clientId !== missingClientId);

      expect(routeTravelRequest({ members: availableMembers, message })).toMatchObject({
        intents,
        memberIds: [],
        mode: 'unavailable',
      });
    },
  );
});
