import type { WorkSummaryItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getWorkResourceActions } from './resourceActions';

describe('work resource actions', () => {
  it('uses the document ID, not the work ID', () => {
    const props = getWorkResourceActions({
      resourceType: 'document',
      resourceId: 'doc-1',
      id: 'work-1',
      title: '行程',
    } as WorkSummaryItem);
    expect(props).toMatchObject({ id: 'doc-1', filename: '行程' });
  });

  it.each(['a.pdf', 'a.docx', 'a.xlsx', 'a.pptx', 'a.png', 'a.mp4', 'a.mp3', 'a.zip', 'a.unknown'])(
    'supports %s without a type allowlist',
    (filename) => {
      const props = getWorkResourceActions({
        resourceType: 'file',
        resourceId: 'user:topic:path',
        title: filename,
        event: { metadata: { fileId: 'file-1', fileUrl: 'https://example.com/file' } },
      } as WorkSummaryItem);
      expect(props).toMatchObject({ id: 'file-1', filename, url: 'https://example.com/file' });
    },
  );

  it('never passes sandbox identity as a file ID', () => {
    expect(
      getWorkResourceActions({
        resourceType: 'file',
        resourceId: 'user:topic:path',
        event: {},
      } as WorkSummaryItem),
    ).toBeNull();
  });
});
