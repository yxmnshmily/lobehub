import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getMessageDownloads, getMessageExportText } from './messageDownloads';

const message = (data: Partial<UIChatMessage>) =>
  ({ id: 'reply-1', content: '', ...data }) as UIChatMessage;

describe('message downloads', () => {
  it('exports all visible child text even when the last block is a tool call', () => {
    const data = message({
      children: [
        { id: 'a', content: '<group_reply ref="msg-1"/>\n第一段' },
        { id: 'b', content: '第二段' },
        { id: 'c', content: '', tools: [{ result: 'private tool payload' } as any] },
      ],
    });
    expect(getMessageExportText(data)).toBe('第一段\n\n第二段');
  });

  it('collects attachments and markdown media once, skipping inaccessible files and code examples', () => {
    const data = message({
      content:
        '![图片](/f/image)\n[视频](https://cdn.example/clip.mp4?token=x)\n[官网](https://example.com)\n```md\n![样例](/f/example)\n```',
      imageList: [{ id: 'image', alt: '桂林.png', url: '/f/image' }],
      fileList: [{ id: 'denied', inaccessible: true, url: '/f/denied', name: 'secret' } as any],
      children: [
        { id: 'b', content: '', fileList: [{ id: 'pdf', url: '/f/pdf', name: '行程.pdf' } as any] },
      ],
    });
    expect(getMessageDownloads(data).map(({ url }) => url)).toEqual([
      '/f/image',
      '/f/pdf',
      'https://cdn.example/clip.mp4?token=x',
    ]);
  });

  it('supports HTML video/audio and reference-style images without executable URLs', () => {
    const data = message({
      content:
        '![封面][cover]\n\n[cover]: /f/cover\n\n<video src="/f/video"></video>\n<audio src="/f/audio"></audio>\n![bad](javascript:alert)',
    });
    expect(getMessageDownloads(data).map(({ url }) => url)).toEqual([
      '/f/cover',
      '/f/video',
      '/f/audio',
    ]);
  });
});
