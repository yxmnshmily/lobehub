import { useState } from 'react';

export const canRetainTopicPage = (errorCode?: string) =>
  !['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'].includes(errorCode ?? '');

export const useRecentTopicControls = <T>(items: T[], defaultExpanded = false) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [oldestFirst, setOldestFirst] = useState(false);
  return {
    expanded,
    oldestFirst,
    setExpanded,
    setOldestFirst,
    topics: oldestFirst ? [...items].reverse() : items,
  };
};
