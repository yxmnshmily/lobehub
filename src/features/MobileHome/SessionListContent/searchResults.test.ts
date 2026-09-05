import { describe, expect, it } from 'vitest';

import { buildVisibleSearchResults, matchesInboxSearch } from './searchResults';

describe('buildVisibleSearchResults', () => {
  it('matches the built-in travel assistant by its visible mobile title', () => {
    expect(matchesInboxSearch('旅游群主')).toBe(true);
    expect(matchesInboxSearch('   ')).toBe(false);
    expect(matchesInboxSearch('不存在的助理')).toBe(false);
  });

  it('keeps a visible platform assistant searchable even when the server search omits it', () => {
    const visibleSessions = [
      {
        config: { id: 'agt_travel', virtual: true },
        id: 'session_travel',
        meta: { title: '旅游群主AI' },
        type: 'agent',
      },
    ] as any;

    expect(
      buildVisibleSearchResults({
        isMobile: true,
        keyword: '旅游群主',
        remoteSessions: [],
        visibleSessions,
      }).map((session) => session.id),
    ).toEqual(['session_travel']);
  });

  it('keeps matching mobile group conversations and removes duplicate remote rows', () => {
    const group = {
      id: 'cg_travel',
      meta: { title: '旅游服务超级群组' },
      type: 'group',
    } as any;

    expect(
      buildVisibleSearchResults({
        isMobile: true,
        keyword: '旅游服务',
        remoteSessions: [group],
        visibleSessions: [group],
      }).map((session) => session.id),
    ).toEqual(['cg_travel']);
  });
});
