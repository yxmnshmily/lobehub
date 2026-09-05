import { describe, expect, it } from 'vitest';

import { routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

const nonProductionSamples = [
  // Video nouns without a production action.
  '我们要做视频号运营规划',
  '视频号账号怎么运营',
  '分析视频号流量数据',
  '这个视频平台有哪些规则',
  '对比几个短视频平台的用户量',
  '帮我找适合看视频的平台',
  '我只想看视频，不要制作',
  '播放刚才的视频',
  '打开视频看看',
  '推荐几个旅游视频',
  '下载这个视频供内部查看',
  '上传现有视频作为参考',

  // Image nouns without a generation or editing action.
  '这张图片仅供参考',
  '这张图片只是参考素材',
  '查看刚才的图片',
  '打开图片看看',
  '浏览图片列表',
  '上传现有图片',
  '下载图片到本地',
  '图文数据怎么看',
  '分析这组图文数据',
  '图片链接在哪里',
  '图片格式是什么',
  '对比两张图片的清晰度',

  // Document nouns used for reading, upload, or inspection.
  '阅读这份 Word',
  '打开 PDF 查看',
  '上传 Word 文件',
  '上传 PDF 作为参考',
  '阅读这份文档内容',
  '查看文档页数',
  '预览现有行程文档',
  '下载现有 PDF',
  '分享 Word 给同事',
  '文档链接在哪里',
  'PDF 格式有什么区别',
  '解析这份文档看看',

  // Route, guide, and budget consultation without an explicit artifact request.
  '成都攻略怎么写',
  '这条路线怎么走',
  '预算大概多少',
  '行程预算怎么控制',
  '能推荐一条川西路线吗',
  '亲子游攻略有什么思路',
  '帮我看看这条路线是否合理',
  '这个预算够不够',
] as const;

const productionSamples = [
  // Copy requests, including vocabulary that should not imply visual generation.
  ['写一份成都旅游攻略', ['copy'], ['copy-agent']],
  ['把路线亮点写成文案', ['copy'], ['copy-agent']],
  ['写一段画面感强的文案', ['copy'], ['copy-agent']],
  ['把行程亮点改成抖音口播', ['copy'], ['copy-agent']],

  // Explicit video production.
  ['制作一条旅游短视频', ['video'], ['video-agent']],
  ['生成一条景区视频', ['video'], ['video-agent']],
  ['把素材剪成 15 秒视频', ['video'], ['video-agent']],
  ['剪辑一条景区宣传成片', ['video'], ['video-agent']],
  ['输出一条旅游短片', ['video'], ['video-agent']],
  ['上传现有视频后制作一条短视频', ['video'], ['video-agent']],

  // Explicit image production.
  ['生成一张旅游封面', ['image'], ['image-agent']],
  ['制作一张旅行海报', ['image'], ['image-agent']],
  ['做一张线路配图', ['image'], ['image-agent']],
  ['帮我生图，主题是海岛', ['image'], ['image-agent']],
  ['生成小红书头图', ['image'], ['image-agent']],
  ['参考这张图片生成一张新封面', ['image'], ['image-agent']],

  // Explicit document production.
  ['导出一份行程单', ['document'], ['document-agent']],
  ['整理成 Word 文档', ['document'], ['document-agent']],
  ['制作 PDF 行程方案', ['document'], ['document-agent']],
  ['生成一份团队报价单', ['document'], ['document-agent']],
  ['把攻略整理成文档', ['document'], ['document-agent']],
  ['导出一份旅游手册', ['document'], ['document-agent']],
  ['阅读 Word 后整理成 PDF', ['document'], ['document-agent']],
] as const;

describe('travel orchestration ambiguity matrix', () => {
  it('keeps at least 60 manually classified positive and negative samples', () => {
    expect(nonProductionSamples.length + productionSamples.length).toBeGreaterThanOrEqual(60);
  });

  it.each(nonProductionSamples)(
    'does not mistake non-production wording for an intent: %s',
    (message) => {
      expect(routeTravelRequest({ members, message })).toEqual({
        intents: [],
        memberIds: [],
        mode: 'supervisor-fallback',
        reason: 'safe-informational',
      });
    },
  );

  it.each(productionSamples)(
    'keeps explicit production wording actionable: %s',
    (message, intents, memberIds) => {
      expect(routeTravelRequest({ members, message })).toEqual({
        intents,
        memberIds,
        mode: 'delegate',
      });
    },
  );
});
