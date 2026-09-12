import { Flexbox } from '@lobehub/ui';
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
      flex={mobile ? 1 : 'none'}
      gap={mobile ? 4 : 12}
      justify={mobile ? 'flex-end' : undefined}
      style={mobile ? { minWidth: 0, maxWidth: '100%' } : undefined}
      wrap={mobile ? 'wrap' : undefined}
    >
      {canShowControls && allowExpand && !audioInputActive && <ContextWindow />}
      {items}
      {!audioInputActive && <CreditBalance />}
      {!audioInputActive && <SendButton />}
    </Flexbox>
  );
});

SendArea.displayName = 'SendArea';

export default SendArea;
