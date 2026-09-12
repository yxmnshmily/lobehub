import { describe, expect, it } from 'vitest';

import { isPersonalInbox, resolvePersonalInboxRedirect as resolveRedirect } from './personalInbox';

const resolvePersonalInboxRedirect = (
  context: Parameters<typeof isPersonalInbox>[0] & { pathname: string; search: string },
) => resolveRedirect({ ...context, personalInbox: isPersonalInbox(context) });

const ownInbox = {
  agentId: 'agt_inbox',
  inboxAgentId: 'agt_inbox',
  isLogin: true,
  workspaceId: null,
};

describe('personal assistant identity', () => {
  it('recognizes only the signed-in user personal inbox, not another agent or a workspace assistant', () => {
    expect(isPersonalInbox(ownInbox)).toBe(true);
    expect(isPersonalInbox({ ...ownInbox, agentId: 'inbox', inboxAgentId: undefined })).toBe(true);
    expect(isPersonalInbox({ ...ownInbox, agentId: 'agt_specialist' })).toBe(false);
    expect(isPersonalInbox({ ...ownInbox, isLogin: false })).toBe(false);
    expect(isPersonalInbox({ ...ownInbox, workspaceId: 'workspace-1' })).toBe(false);
    expect(isPersonalInbox({ ...ownInbox, agentId: undefined, inboxAgentId: undefined })).toBe(
      false,
    );
  });

  it('routes both old inbox aliases and saved inbox IDs to the current user default group resolver', () => {
    expect(
      resolvePersonalInboxRedirect({ ...ownInbox, pathname: '/agent/agt_inbox', search: '' }),
    ).toBe('/group/default');
    expect(
      resolvePersonalInboxRedirect({
        ...ownInbox,
        agentId: 'inbox',
        pathname: '/agent/inbox/',
        search: '',
      }),
    ).toBe('/group/default');
  });

  it('preserves old topic records and settings instead of treating their IDs as group topics', () => {
    for (const pathname of [
      '/agent/agt_inbox/topic-old',
      '/agent/agt_inbox/topics',
      '/agent/agt_inbox/profile',
    ]) {
      expect(resolvePersonalInboxRedirect({ ...ownInbox, pathname, search: '' })).toBeUndefined();
    }
    expect(
      resolvePersonalInboxRedirect({
        ...ownInbox,
        pathname: '/agent/agt_inbox',
        search: '?topic=old-topic',
      }),
    ).toBeUndefined();
  });

  it('leaves unrelated, signed-out and workspace navigation intact', () => {
    expect(
      resolvePersonalInboxRedirect({
        ...ownInbox,
        agentId: 'agt_other',
        pathname: '/agent/agt_other',
        search: '',
      }),
    ).toBeUndefined();
    expect(
      resolvePersonalInboxRedirect({
        ...ownInbox,
        isLogin: false,
        pathname: '/agent/agt_inbox',
        search: '',
      }),
    ).toBeUndefined();
    expect(
      resolvePersonalInboxRedirect({
        ...ownInbox,
        workspaceId: 'w1',
        pathname: '/w1/agent/agt_inbox',
        search: '',
      }),
    ).toBeUndefined();
  });
});
