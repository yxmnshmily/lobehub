import type { WorkSummaryItem } from '@lobechat/types';

import { PAGE_FILE_TYPE } from '@/features/ResourceManager/constants';
import { isSafeExternalUrl } from '@/features/Work/descriptors';

/** Resource APIs require a document/file ID, never a Work ID or sandbox path. */
export const getWorkResourceActions = (item: WorkSummaryItem) => {
  const id =
    item.resourceType === 'document'
      ? item.resourceId
      : item.resourceType === 'file'
        ? item.event.metadata?.fileId
        : null;
  if (!id) return null;
  const url = item.event?.metadata?.fileUrl ?? item.url;
  return {
    id,
    filename: item.title || item.identifier || id,
    fileType: item.resourceType === 'document' ? PAGE_FILE_TYPE : 'application/octet-stream',
    url: isSafeExternalUrl(url) ? url : '',
    userId: item.userId,
    visibility: item.visibility,
  };
};
