import { describe, expect, it } from 'vitest';

import { collectFiles } from './collectFiles';

describe('collectFiles', () => {
  it('includes nested group attachments once and prefers the authenticated download URL', () => {
    const file = { id: 'f1', name: '行程.pdf', url: '/f/1', downloadUrl: '/api/download/1' };
    expect(collectFiles([{ fileList: [file], members: [{ fileList: [file] }] }] as any)).toEqual([
      { category: 'documents', name: '行程.pdf', url: '/api/download/1' },
    ]);
  });

  it('finds generated document and file links while excluding unsafe links and inaccessible files', () => {
    expect(
      collectFiles([
        {
          content:
            '[行程](/page/docs_trip) [下载](https://example.com/trip.pdf) [坏文件](javascript:bad.pdf)',
          fileList: [{ id: 'private', inaccessible: true, url: '/secret', name: 'secret' }],
        },
      ] as any),
    ).toEqual([
      { category: 'documents', documentId: 'docs_trip', name: '行程' },
      { category: 'documents', name: '下载', url: 'https://example.com/trip.pdf' },
    ]);
  });
});
