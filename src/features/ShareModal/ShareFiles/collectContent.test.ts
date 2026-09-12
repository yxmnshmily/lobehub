import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { collectContent, filterContent } from './collectContent';

const messages = (values: unknown[]) => values as UIChatMessage[];

describe('conversation content archive', () => {
  it('keeps only the final output, not tool narration, intermediate blocks or placeholders', () => {
    const items = collectContent(
      messages([
        { id: 'start', role: 'assistant', content: '开始处理', tools: [{ id: 'tool' }] },
        { id: 'progress', role: 'assistant', content: '处理中' },
        { id: 'final', role: 'assistant', parentId: 'progress', content: '桂林山水，等你入画。' },
        { id: 'placeholder', role: 'assistant', content: '...' },
        {
          id: 'group',
          role: 'assistantGroup',
          children: [
            { id: 'start', content: '开始处理', tools: [{ id: 'tool' }] },
            { id: 'progress', content: '处理中' },
            { id: 'final', content: '桂林山水，等你入画。' },
          ],
        },
      ]),
    );
    expect(items.map((item) => item.content)).toEqual(['桂林山水，等你入画。']);
  });
  it('includes nested assistant blocks and excludes executable and malformed attachment URLs', () => {
    const items = collectContent(
      messages([
        {
          children: [
            {
              id: 'nested',
              content: '分组助理文案',
              council: [{ id: 'council', role: 'assistant', content: '协作助理文案' }],
            },
          ],
          fileList: [
            { name: 'bad.pdf', url: 'javascript:alert(1)' },
            { name: 'bad.pdf', url: '/\\example.com/bad.pdf' },
            { name: 'bad.pdf', url: '/\n/example.com/bad.pdf' },
          ],
        },
      ]),
    );
    expect(items.map((item) => item.content)).toEqual(['分组助理文案', '协作助理文案']);
  });
  it('classifies attachments by MIME type, original name and URL rather than the download proxy', () => {
    const items = collectContent(
      messages([
        {
          fileList: [
            {
              name: '封面',
              fileType: 'image/png',
              url: '/f/image',
              downloadUrl: '/download/image',
            },
            { name: '文案.md', url: '/f/text' },
            { name: '成片.MP4', url: '/f/video' },
            { name: '行程.docx', url: '/f/doc' },
            { name: '素材.zip', url: '/f/zip' },
          ],
        },
      ]),
    );
    expect(items.map((item) => item.category)).toEqual([
      'images',
      'text',
      'media',
      'documents',
      'other',
    ]);
    expect(filterContent(items, 'images')[0].url).toBe('/download/image');
    expect(filterContent(items, 'all')).toHaveLength(5);
  });

  it('automatically includes assistant copy once across raw and nested display messages', () => {
    const reply = { id: 'm1', role: 'assistant', content: '桂林山水，等你入画。' };
    const items = collectContent(
      messages([
        reply,
        { members: [reply] },
        { id: 'u1', role: 'user', content: '帮我写文案' },
        { id: 's1', role: 'system', content: 'secret prompt' },
        { id: 't1', role: 'tool', content: 'tool trace' },
      ]),
    );
    expect(filterContent(items, 'text')).toMatchObject([
      { messageId: 'm1', content: '桂林山水，等你入画。' },
    ]);
    expect(items).toHaveLength(1);
  });

  it('collects generated images, audio, video and internal documents, without unsafe downloads', () => {
    const items = collectContent(
      messages([
        {
          imageList: [{ id: 'i1', alt: '封面', url: '/image/1' }],
          audioList: [{ id: 'a1', alt: '配音', url: '/audio/1' }],
          videoList: [{ id: 'v1', alt: '成片', url: '/video/1' }],
          content:
            '[行程](/page/docs_trip) [视频](https://example.com/video.webm) [危险](javascript:bad.pdf)',
          fileList: [{ name: '隐藏.pdf', inaccessible: true, url: '/private' }],
        },
      ]),
    );
    expect(filterContent(items, 'images')).toHaveLength(1);
    expect(filterContent(items, 'media')).toHaveLength(3);
    expect(filterContent(items, 'documents')).toMatchObject([{ documentId: 'docs_trip' }]);
    expect(items).toHaveLength(5);
  });

  it('updates archived copy from the message source and does not archive empty or failed replies', () => {
    expect(
      collectContent(messages([{ id: 'm1', role: 'assistant', content: '修改后的文案' }]))[0]
        .content,
    ).toBe('修改后的文案');
    expect(
      collectContent(
        messages([
          { id: 'm1', role: 'assistant', content: '   ' },
          { id: 'm2', role: 'assistant', content: '失败', error: { message: 'failed' } },
        ]),
      ),
    ).toEqual([]);
  });
});
