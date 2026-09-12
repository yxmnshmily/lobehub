import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, useResponsive } from 'antd-style';
import { type CSSProperties, memo } from 'react';

import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { isDev } from '@/utils/env';

import { contextSelectors, useConversationStore } from '../../store';
import type { ChatItemProps } from '../type';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    min-width: 0;
    max-width: 100%;

    @media (width <= 768px) {
      width: 100%;
      flex-wrap: wrap;
      row-gap: 8px;
    }
  `,
  menu: css`
    min-width: 0;
    max-width: 100%;

    @media (width <= 768px) {
      flex: 1 1 100%;
      flex-wrap: wrap;
      row-gap: 8px;

      /* Keep the tap target intact while making the dense message chrome
         visually quieter on a narrow screen. This also covers the reaction
         and group-reply controls that share the same menubar. */
      button svg {
        width: 12px;
        height: 12px;
      }

      button {
        min-width: var(--message-action-control-size) !important;
        width: var(--message-action-control-size) !important;
        min-height: var(--message-action-control-size) !important;
        height: var(--message-action-control-size) !important;
      }

      [data-message-usage] {
        order: 1;
        flex: 0 0 100%;
        width: 100%;
      }
    }
  `,
  menuLeft: css`
    @media (width <= 768px) {
      justify-content: flex-start;
    }
  `,
  menuRight: css`
    @media (width <= 768px) {
      justify-content: flex-end;
    }
  `,
}));

export interface ActionsProps {
  actionAddon?: ChatItemProps['actionAddon'];
  actions: ChatItemProps['actions'];
  placement?: ChatItemProps['placement'];
}

const Actions = memo<ActionsProps>(({ actionAddon, placement, actions }) => {
  const onboardingAgentId = useAgentStore(builtinAgentSelectors.webOnboardingAgentId);
  const conversationAgentId = useConversationStore(contextSelectors.agentId);
  const { mobile = false } = useResponsive();
  if (!isDev && onboardingAgentId && conversationAgentId === onboardingAgentId) return null;

  const isUser = placement === 'right';
  return (
    <Flexbox
      align={'center'}
      className={styles.container}
      direction={'horizontal'}
      gap={4}
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {!isUser && actionAddon}
      {actions && (
        <Flexbox
          horizontal
          align={'center'}
          className={`${styles.menu} ${isUser ? styles.menuRight : styles.menuLeft}`}
          data-mobile-action-footer={mobile || undefined}
          role="menubar"
          style={
            mobile
              ? ({
                  '--message-action-control-size': '28px',
                  opacity: 1,
                  pointerEvents: 'auto',
                } as CSSProperties)
              : undefined
          }
        >
          {actions}
        </Flexbox>
      )}
      {isUser && actionAddon}
    </Flexbox>
  );
});

export default Actions;
