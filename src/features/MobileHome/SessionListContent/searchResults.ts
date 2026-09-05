import { type LobeAgentSession, type LobeSessions } from '@/types/session';
import { LobeSessionType } from '@/types/session';

export const MOBILE_INBOX_TITLE = '旅游群主AI';

export const matchesInboxSearch = (keyword: string) => {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  return (
    Boolean(normalizedKeyword) && MOBILE_INBOX_TITLE.toLocaleLowerCase().includes(normalizedKeyword)
  );
};

const matchesKeyword = (session: LobeSessions[0], keyword: string) => {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase();
  if (!normalizedKeyword) return false;

  return [session.meta?.title, session.meta?.description].some((value) =>
    value?.toLocaleLowerCase().includes(normalizedKeyword),
  );
};

export const buildVisibleSearchResults = ({
  isMobile,
  keyword,
  remoteSessions = [],
  visibleSessions,
}: {
  isMobile: boolean;
  keyword: string;
  remoteSessions?: LobeSessions;
  visibleSessions: LobeSessions;
}): LobeSessions => {
  const results = new Map(remoteSessions.map((session) => [session.id, session]));

  for (const session of visibleSessions) {
    if (matchesKeyword(session, keyword) && !results.has(session.id)) {
      results.set(session.id, session);
    }
  }

  const merged = [...results.values()];
  if (isMobile) return merged;

  return merged.filter(
    (session) =>
      session.type !== LobeSessionType.Agent ||
      !Boolean((session as LobeAgentSession).config?.virtual),
  );
};
