'use client';

import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { Loader2 } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import { usePersonalInbox } from '@/features/AgentRoute/usePersonalInbox';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import NavItem from '@/features/NavPanel/components/NavItem';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { usePrefetchAgent } from '@/hooks/usePrefetchAgent';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';

import { usePreservedAgentUrl } from './usePreservedAgentUrl';

const styles = createStaticStyles(({ css, cssVar }) => ({
  runningBadge: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: -3px;
    inset-inline-end: -3px;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 14px;
    height: 14px;
    border: 0.5px solid ${cssVar.colorBgContainer};
    border-radius: 999px;

    color: ${cssVar.colorWarning};

    background: ${cssVar.colorBgContainer};
  `,
  wrapper: css`
    position: relative;
    display: inline-flex;
  `,
}));

interface InboxItemProps {
  className?: string;
  fallbackTitle?: string;
  style?: CSSProperties;
}

const InboxItem = memo<InboxItemProps>(({ className, fallbackTitle = '旅游群主AI', style }) => {
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxRouteAgentId = resolveInboxAgentRouteId(inboxAgentId);
  const personalInbox = usePersonalInbox(inboxRouteAgentId);
  const inboxMeta = useAgentStore(agentSelectors.getAgentMetaById(inboxRouteAgentId));

  const isLoading = useChatStore(
    inboxAgentId ? operationSelectors.isAgentVisiblyRunning(inboxAgentId) : () => false,
  );
  const prefetchAgent = usePrefetchAgent();
  const inboxAgentTitle = agentDisplayName(inboxMeta, personalInbox ? '旅游群' : fallbackTitle);
  const inboxAgentAvatar = inboxMeta.avatar || DEFAULT_INBOX_AVATAR;
  const inboxUrl = usePreservedAgentUrl(inboxRouteAgentId);

  // Prefetch agent layout chunk and data eagerly since Lobe AI is almost always clicked
  if (inboxAgentId && !personalInbox) prefetchAgent(inboxAgentId);

  const avatarNode = (
    <Avatar emojiScaleWithBackground avatar={inboxAgentAvatar} shape={'square'} size={24} />
  );

  return (
    <WorkspaceLink aria-label={inboxAgentTitle} to={personalInbox ? '/group/default' : inboxUrl}>
      <NavItem
        className={className}
        style={style}
        title={inboxAgentTitle}
        icon={
          isLoading && !personalInbox ? (
            <span className={styles.wrapper}>
              {avatarNode}
              <span className={styles.runningBadge}>
                <Icon spin icon={Loader2} size={9} />
              </span>
            </span>
          ) : (
            avatarNode
          )
        }
      />
    </WorkspaceLink>
  );
});

export default InboxItem;
