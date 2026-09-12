import type { WorkSummaryItem } from '@lobechat/types';
import { expect, it } from 'vitest';

import type { ResourceItem } from '@/types/resource';

import { mergeOtherResources } from './items';

it('puts raw files, audio and works into one list, deduplicating the same persisted file', () => {
  const resources = [
    { id: 'zip', fileType: 'application/zip', updatedAt: new Date(3) },
    { id: 'audio', fileType: 'audio/mpeg', updatedAt: new Date(1) },
    { id: 'derived-page', fileId: 'generated-file', updatedAt: new Date(2) },
  ] as ResourceItem[];
  const works = [
    {
      id: 'work',
      resourceType: 'file',
      event: { metadata: { fileId: 'generated-file' } },
      updatedAt: new Date(2),
    },
    { id: 'doc-work', resourceType: 'document', event: { metadata: null }, updatedAt: new Date(4) },
  ] as WorkSummaryItem[];
  expect(mergeOtherResources(resources, works).map(({ item }) => item.id)).toEqual([
    'doc-work',
    'zip',
    'work',
    'audio',
  ]);
});
