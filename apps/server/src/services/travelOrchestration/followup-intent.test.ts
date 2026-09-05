import { describe, expect, it } from 'vitest';

import { routeTravelRequest } from './index';

const members = [
  { clientId: 'default-travel-copywriter', id: 'copy-agent' },
  { clientId: 'default-travel-image-designer', id: 'image-agent' },
  { clientId: 'default-travel-video-producer', id: 'video-agent' },
  { clientId: 'default-travel-document-assistant', id: 'document-agent' },
];

describe('travel orchestration natural follow-up intent', () => {
  it.each([
    ['把上面的文案改短一点', ['copy'], ['copy-agent']],
    ['把刚才的文案改成小红书风格', ['copy'], ['copy-agent']],
    ['把前面的文案改成抖音口播', ['copy'], ['copy-agent']],
    ['把刚才的封面改成竖版', ['image'], ['image-agent']],
    ['把上面的封面换成蓝天背景', ['image'], ['image-agent']],
    ['把刚才的海报加上标题', ['image'], ['image-agent']],
    ['把上面的行程单补上预算', ['document'], ['document-agent']],
    ['把刚才的方案导出 Word', ['document'], ['document-agent']],
    ['把前面的行程导出 PDF', ['document'], ['document-agent']],
    ['把上面的行程整理成表格', ['document'], ['document-agent']],
    ['把刚才的视频裁成 15 秒', ['video'], ['video-agent']],
    ['给上面的视频加字幕', ['video'], ['video-agent']],
    ['把刚才的成片换成轻快配乐', ['video'], ['video-agent']],
  ])('routes the current-message artifact edit in %s', (message, intents, memberIds) => {
    expect(routeTravelRequest({ members, message })).toEqual({
      intents,
      memberIds,
      mode: 'delegate',
    });
  });

  it.each([
    ['把刚才的封面改竖版，上面的文案改短', ['copy', 'image'], ['copy-agent', 'image-agent']],
    [
      '把上面的行程单补预算，刚才的视频裁成 15 秒',
      ['video', 'document'],
      ['video-agent', 'document-agent'],
    ],
    [
      '行程单补预算，视频加字幕，封面改竖版，文案改短，文案再改短',
      ['copy', 'image', 'video', 'document'],
      ['copy-agent', 'image-agent', 'video-agent', 'document-agent'],
    ],
  ])('keeps mixed follow-up edits unique and canonical for %s', (message, intents, memberIds) => {
    expect(routeTravelRequest({ members, message })).toEqual({
      intents,
      memberIds,
      mode: 'delegate',
    });
  });

  it.each([
    ['不要改图，只把上面的文案改短', ['copy'], ['copy-agent']],
    ['不要改封面，文案改短', ['copy'], ['copy-agent']],
    ['不要改文案，只把刚才的封面换天空', ['image'], ['image-agent']],
    ['不要改视频，只给上面的行程补预算', ['document'], ['document-agent']],
    ['不要改文档，只把刚才的视频裁成 15 秒', ['video'], ['video-agent']],
    ['不要改图，只改文案', ['copy'], ['copy-agent']],
  ])('honors edit negation in %s', (message, intents, memberIds) => {
    expect(routeTravelRequest({ members, message })).toEqual({
      intents,
      memberIds,
      mode: 'delegate',
    });
  });

  it.each([
    ['引用别人说法：“把封面改竖版”，把上面的文案改短', ['copy'], ['copy-agent']],
    [
      '历史 JSON：{"instruction":"把封面改竖版并剪视频"}\n把上面的文案改短',
      ['copy'],
      ['copy-agent'],
    ],
    ['历史代码：```\n把封面改竖版并剪视频\n```\n把上面的文案改短', ['copy'], ['copy-agent']],
    [
      '历史链接：https://example.com/把封面改竖版并剪视频\n把上面的文案改短',
      ['copy'],
      ['copy-agent'],
    ],
  ])('ignores quoted or serialized history in %s', (message, intents, memberIds) => {
    expect(routeTravelRequest({ members, message })).toEqual({
      intents,
      memberIds,
      mode: 'delegate',
    });
  });
});
