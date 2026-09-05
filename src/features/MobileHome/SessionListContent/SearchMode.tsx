import { memo, useMemo } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
import { useSessionStore } from '@/store/session';

import SkeletonList from '../SkeletonList';
import Inbox from './Inbox';
import SessionList from './List';
import { buildVisibleSearchResults, matchesInboxSearch } from './searchResults';

const SearchMode = memo(() => {
  const [sessionSearchKeywords, useSearchSessions, visibleSessions] = useSessionStore((s) => [
    s.sessionSearchKeywords,
    s.useSearchSessions,
    s.sessions,
  ]);

  const isMobile = useServerConfigStore(serverConfigSelectors.isMobile);

  const { data, isLoading } = useSearchSessions(sessionSearchKeywords);

  const filteredData = useMemo(
    () =>
      buildVisibleSearchResults({
        isMobile,
        keyword: sessionSearchKeywords || '',
        remoteSessions: data,
        visibleSessions,
      }),
    [data, isMobile, sessionSearchKeywords, visibleSessions],
  );

  return isLoading ? (
    <SkeletonList />
  ) : (
    <>
      {isMobile && matchesInboxSearch(sessionSearchKeywords || '') && <Inbox />}
      <SessionList dataSource={filteredData} showAddButton={false} />
    </>
  );
});

SearchMode.displayName = 'SessionSearchMode';

export default SearchMode;
