'use client';

import { DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID, type HostedGroupChatBilling } from '@lobechat/types';
import { Flexbox, InputNumber, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useCallback, useRef, useState } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput } from '@/features/Conversation';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';

import { useSendMenuItems } from './useSendMenuItems';

const leftActions: ActionKeys[] = [
  'search',
  'memory',
  'fileUpload',
  'tools',
  'voiceDictation',
  '---',
  ['typo', 'params', 'clear'],
];

const rightActions: ActionKeys[] = ['model', 'voiceMessage', 'contextWindow'];

const MAX_SAFE_CREDITS = Number.MAX_SAFE_INTEGER;

const isValidCredits = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value > 0;

const syncMainInputEditor = (instance: any) => {
  useChatStore.setState({ mainInputEditor: instance });
};

const HostedTravelGroupChatInput = memo<{ sendMenuItems: ReturnType<typeof useSendMenuItems> }>(
  ({ sendMenuItems }) => {
    const isMobile = useServerConfigStore((state) => state.isMobile);
    const [maxCredits, setMaxCredits] = useState<number | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const startLockRef = useRef(false);
    const valid = isValidCredits(maxCredits);

    const createBillingForSend = useCallback((): HostedGroupChatBilling | false => {
      if (startLockRef.current || !isValidCredits(maxCredits)) return false;

      startLockRef.current = true;
      setIsStarting(true);
      return { idempotencyKey: globalThis.crypto.randomUUID(), maxCredits };
    }, [maxCredits]);

    const releaseStartLock = useCallback(() => {
      startLockRef.current = false;
      setIsStarting(false);
    }, []);

    return (
      <ChatInput
        disableQueue
        skipScrollMarginWithList
        createBillingForSend={createBillingForSend}
        leftActions={leftActions}
        rightActions={rightActions}
        sendButtonProps={!valid || isStarting ? { disabled: true } : undefined}
        sendMenu={{ items: sendMenuItems }}
        sendAreaPrefix={
          <Flexbox horizontal align={'center'} gap={6}>
            <span
              style={{ color: cssVar.colorTextDescription, fontSize: 12, whiteSpace: 'nowrap' }}
            >
              {isMobile ? '最高 Credits' : '本次最高消费 Credits'}
            </span>
            <Tooltip title="请填写正整数，仅限制本次请求最高消耗">
              <InputNumber
                aria-label="本次最高消费 Credits"
                disabled={isStarting}
                max={MAX_SAFE_CREDITS}
                min={1}
                placeholder="Credits"
                precision={0}
                status={maxCredits !== null && !valid ? 'error' : undefined}
                step={1}
                style={{ width: isMobile ? 80 : 104 }}
                value={maxCredits}
                onChange={(value) => setMaxCredits(typeof value === 'number' ? value : null)}
              />
            </Tooltip>
          </Flexbox>
        }
        onBilledSendAccepted={releaseStartLock}
        onEditorReady={syncMainInputEditor}
        onBilledSendSettled={({ accepted }) => {
          releaseStartLock();
          if (accepted) setMaxCredits(null);
        }}
      />
    );
  },
);

HostedTravelGroupChatInput.displayName = 'HostedTravelGroupChatInput';

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo(() => {
  const sendMenuItems = useSendMenuItems();
  const isHostedTravelGroup = useAgentGroupStore((state) => {
    const currentGroup = state.activeGroupId
      ? agentGroupSelectors.getGroupById(state.activeGroupId)(state)
      : undefined;
    return currentGroup?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID;
  });

  if (isHostedTravelGroup) return <HostedTravelGroupChatInput sendMenuItems={sendMenuItems} />;

  return (
    <ChatInput
      skipScrollMarginWithList
      leftActions={leftActions}
      rightActions={rightActions}
      sendMenu={{ items: sendMenuItems }}
      onEditorReady={syncMainInputEditor}
    />
  );
});

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;
