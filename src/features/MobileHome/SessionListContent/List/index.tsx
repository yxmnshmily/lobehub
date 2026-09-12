import { AGENT_CHAT_URL, GROUP_CHAT_URL } from '@lobechat/const';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import LazyLoad from 'react-lazy-load';
import { Link } from 'react-router';

import { useNavigateToAgent } from '@/hooks/useNavigateToAgent';
import { useAnalytics } from '@/libs/analytics/client';
import { useServerConfigStore } from '@/store/serverConfig';
import { getSessionStoreState, useSessionStore } from '@/store/session';
import { sessionGroupSelectors, sessionSelectors } from '@/store/session/selectors';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { type LobeSessions } from '@/types/session';

import SkeletonList from '../../SkeletonList';
import AddButton from './AddButton';
import SessionItem from './Item';

const styles = createStaticStyles(
  ({ css }) => css`
    min-height: 70px;
  `,
);
interface SessionListProps {
  dataSource?: LobeSessions;
  groupId?: string;
  showAddButton?: boolean;
}

export const resolveSessionUrl = ({
  agentId,
  id,
  mobile,
  type,
}: {
  agentId?: string;
  id: string;
  mobile: boolean;
  type: 'agent' | 'group';
}) => (type === 'group' ? GROUP_CHAT_URL(id) : AGENT_CHAT_URL(agentId!, mobile));

const SessionList = memo<SessionListProps>(({ dataSource, groupId, showAddButton = true }) => {
  const { analytics } = useAnalytics();

  const isInit = useSessionStore(sessionSelectors.isSessionListInit);
  const mobile = useServerConfigStore((s) => s.isMobile);

  const navigateToAgent = useNavigateToAgent();

  const isEmpty = !dataSource || dataSource.length === 0;
  return !isInit ? (
    <SkeletonList />
  ) : !isEmpty ? (
    dataSource.map(({ id, ...res }) => (
      <LazyLoad className={styles} key={id}>
        <Link
          aria-label={(res as any).meta?.title || id}
          to={resolveSessionUrl({
            agentId: (res as any).config?.id,
            id,
            mobile: !!mobile,
            type: res.type,
          })}
          onClick={(e) => {
            if (res.type === 'agent') {
              e.preventDefault();
              navigateToAgent((res as any).config?.id);
            }

            // Enhanced analytics tracking
            if (analytics) {
              const userStore = getUserStoreState();
              const sessionStore = getSessionStoreState();

              const userId = userProfileSelectors.userId(userStore);
              const session = sessionSelectors.getSessionById(id)(sessionStore);

              if (session) {
                const sessionGroupId = session.group || 'default';
                const group = sessionGroupSelectors.getGroupById(sessionGroupId)(sessionStore);
                const groupName =
                  group?.name || (sessionGroupId === 'default' ? 'Default' : 'Unknown');

                analytics?.track({
                  name: 'switch_session',
                  properties: {
                    assistant_name: session.meta?.title || 'Untitled Agent',
                    assistant_tags: session.meta?.tags || [],
                    group_id: sessionGroupId,
                    group_name: groupName,
                    session_id: id,
                    spm: 'homepage.chat.session_list_item.click',
                    user_id: userId || 'anonymous',
                  },
                });
              }
            }
          }}
        >
          <SessionItem id={id} />
        </Link>
      </LazyLoad>
    ))
  ) : (
    showAddButton && <AddButton groupId={groupId} />
  );
});

export default SessionList;
