'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Block, Flexbox } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { memo } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { itemStyles } from './style';

interface AgentItemProps {
  agentId?: string;
  avatar?: string;
  backgroundColor?: string;
  description?: string;
  identifier?: string;
  title?: string;
}

const AgentItem = memo<AgentItemProps>(
  ({ agentId, avatar, title, description, identifier, backgroundColor }) => {
    const styles = itemStyles;

    if (!identifier || !title) return null;

    const content = (
      <Block
        clickable
        horizontal
        align={'center'}
        className={styles.container}
        gap={12}
        paddingBlock={12}
        paddingInline={12}
        style={{ cursor: 'pointer', height: '100%' }}
        variant={'outlined'}
      >
        <Avatar
          avatar={avatar}
          background={backgroundColor || 'transparent'}
          shape={'square'}
          size={40}
          style={{ flex: 'none' }}
        />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <span className={styles.title}>{title}</span>
          {description && <span className={styles.description}>{description}</span>}
        </Flexbox>
      </Block>
    );
    return agentId ? (
      <WorkspaceLink
        style={{ display: 'block', height: '100%' }}
        to={AGENT_CHAT_URL(agentId, false)}
      >
        {content}
      </WorkspaceLink>
    ) : (
      <WorkspaceLink
        rel="noopener noreferrer"
        style={{ display: 'block', height: '100%' }}
        target="_blank"
        to={`/community/agent/${identifier}`}
      >
        {content}
      </WorkspaceLink>
    );
  },
);

export default AgentItem;
