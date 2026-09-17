import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';

import { type ActionKey } from '../ActionBar/config';
import { actionMap } from '../ActionBar/config';
import ContextWindow from '../ActionBar/Token';
import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { useChatInputStore } from '../store';
import CreditBalance from './CreditBalance';
import { resolveSendAreaActionKeys } from './resolveActionKeys';
import SendButton from './SendButton';

const styles = createStaticStyles(({ css }) => ({
  credits: css`
    display: flex;
    flex: none;

    [data-credit-full-label] {
      display: flex;
      gap: 4px;
      align-items: center;
    }

    [data-credit-compact-icon] {
      display: none;
    }

    @container compact-composer (min-width: 0) {
      [data-credit-trigger] {
        inline-size: 28px;
        min-inline-size: 28px;
        block-size: 28px;
        padding: 0;
        border-radius: 50%;
      }

      [data-credit-full-label] {
        display: none;
      }

      [data-credit-compact-icon] {
        display: block;
        flex: none;
      }
    }
  `,
}));

const mapActionsToItems = (keys: ActionKey[]) =>
  keys.map((actionKey) => {
    const Render = actionMap[actionKey];
    return <Render key={actionKey} />;
  });

interface SendAreaProps {
  /**
   * Strip `contextWindow` from the rendered actions because a ControlBar below
   * the composer hosts it instead. Composers without a ControlBar must pass
   * `false` or the token indicator has nowhere to render.
   */
  hideContextWindow?: boolean;
}

const SendArea = memo<SendAreaProps>(({ hideContextWindow = true }) => {
  const { canShowControls } = useChatInputResourceAccess();
  const [allowExpand, mobile] = useChatInputStore((s) => [s.allowExpand, s.mobile]);
  const rightActions = useChatInputStore((s) => s.rightActions, isEqual);
  const activeAudioInputMode = useChatInputStore((s) => s.activeAudioInputMode);
  const audioInputActive = activeAudioInputMode !== undefined;

  const items = useMemo(
    () =>
      canShowControls
        ? mapActionsToItems(
            resolveSendAreaActionKeys(
              rightActions as ActionKey[],
              hideContextWindow || !!allowExpand,
              activeAudioInputMode,
            ),
          )
        : [],
    [activeAudioInputMode, allowExpand, canShowControls, hideContextWindow, rightActions],
  );

  return (
    <Flexbox
      horizontal
      align={'center'}
      flex={mobile ? 1 : '0 1 auto'}
      gap={mobile ? 4 : 12}
      justify={mobile ? 'flex-end' : undefined}
      style={mobile ? { minWidth: 0, maxWidth: '100%' } : { minWidth: 0 }}
      wrap={mobile ? 'wrap' : undefined}
    >
      {canShowControls && allowExpand && !audioInputActive && <ContextWindow />}
      {items}
      {!audioInputActive && (
        <div className={styles.credits}>
          <CreditBalance />
        </div>
      )}
      {!audioInputActive && <SendButton />}
    </Flexbox>
  );
});

SendArea.displayName = 'SendArea';

export default SendArea;
