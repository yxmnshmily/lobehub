'use client';

import {
  agentDisplayName,
  DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID,
  type HostedGroupChatBilling,
} from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { Bot, Smartphone } from 'lucide-react';
import { memo, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { withLobeHubMountPath } from '@/features/Auth/utils/mountedPath';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput, type ChatInputProps } from '@/features/Conversation';
import TravelPromptShortcuts from '@/features/TravelPromptShortcuts';
import { useSession } from '@/libs/better-auth/auth-client';
import { lambdaQuery } from '@/libs/trpc/client';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';

import { useSendMenuItems } from './useSendMenuItems';

const leftActions: ActionKeys[] = [
  'search',
  'memory',
  'fileUpload',
  'tools',
  'voiceDictation',
  '---',
  ['typo', 'params', 'clear', 'mention'],
];

const rightActions: ActionKeys[] = ['model', 'voiceMessage', 'contextWindow'];

const useGroupMentionItems = () => {
  const agents = useAgentGroupStore((s) =>
    s.activeGroupId ? s.groupMap[s.activeGroupId]?.agents : undefined,
  );
  return useMemo(
    () =>
      (agents ?? []).map((agent) => ({
        key: agent.id,
        label: agentDisplayName(agent, agent.id),
        metadata: { id: agent.id, type: 'member' },
      })),
    [agents],
  );
};

const syncMainInputEditor = (instance: any) => {
  useChatStore.setState({ mainInputEditor: instance });
};

interface ComposerHostProps {
  children?: ReactNode;
  onBilledSendAccepted?: () => void;
}

const HostedTravelGroupChatInput = memo<
  ComposerHostProps & { sendMenuItems: ReturnType<typeof useSendMenuItems> }
>(({ children, onBilledSendAccepted, sendMenuItems }) => {
  const mentionItems = useGroupMentionItems();
  const groupId = useAgentGroupStore((s) => s.activeGroupId);
  const topics = lambdaQuery.groupConversation.listTopics.useQuery(
    { groupId: groupId ?? '', limit: 1, recent: true },
    { enabled: !!groupId, refetchOnWindowFocus: false },
  );
  const [isStarting, setIsStarting] = useState(false);
  const startLockRef = useRef(false);

  const createBillingForSend = useCallback((): HostedGroupChatBilling | false => {
    if (!topics.data || startLockRef.current) return false;

    startLockRef.current = true;
    setIsStarting(true);
    return { idempotencyKey: globalThis.crypto.randomUUID() };
  }, [topics.data]);

  const releaseStartLock = useCallback(() => {
    startLockRef.current = false;
    setIsStarting(false);
  }, []);

  return (
    <ChatInput
      disableQueue
      children={children}
      createBillingForSend={createBillingForSend}
      /* 2026-09-18：补回一排提示词——群组首页编辑器（WorkGroupHome）一直有
         TravelPromptShortcuts，但会话页输入框从没挂过；用户口径是会话页同款。 */
      inputBanner={<TravelPromptShortcuts />}
      leftActions={leftActions}
      mentionItems={mentionItems}
      rightActions={rightActions}
      sendMenu={{ items: sendMenuItems }}
      showControlBar={false}
      sendButtonProps={
        isStarting || !topics.data ? { disabled: true } : children ? { shape: 'round' } : undefined
      }
      onBilledSendSettled={releaseStartLock}
      onEditorReady={syncMainInputEditor}
      onBilledSendAccepted={() => {
        releaseStartLock();
        onBilledSendAccepted?.();
      }}
    />
  );
});

HostedTravelGroupChatInput.displayName = 'HostedTravelGroupChatInput';

/**
 * MainChatInput
 *
 * Custom ChatInput implementation for main chat page.
 * Uses ChatInput from @/features/Conversation which handles all send logic
 * including error alerts display.
 * Only adds MessageFromUrl for desktop mode.
 */
const MainChatInput = memo<ComposerHostProps & { runtimeProps?: ChatInputProps }>(
  ({ children, onBilledSendAccepted, runtimeProps }) => {
    const { t } = useTranslation('auth');
    const { data: session } = useSession();
    const sendMenuItems = useSendMenuItems();
    const mentionItems = useGroupMentionItems();
    const isHostedTravelGroup = useAgentGroupStore((state) => {
      const currentGroup = state.activeGroupId
        ? agentGroupSelectors.getGroupById(state.activeGroupId)(state)
        : undefined;
      return currentGroup?.clientId === DEFAULT_TRAVEL_SERVICE_GROUP_CLIENT_ID;
    });

    if (!session?.user.phoneNumber?.trim() || session.user.phoneNumberVerified !== true) {
      return (
        <Flexbox
          align="center"
          gap={12}
          style={{
            padding: 20,
            borderRadius: 16,
            background: cssVar.colorFillTertiary,
            color: cssVar.colorTextTertiary,
            textAlign: 'center',
          }}
        >
          <button
            disabled
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: 0,
              padding: 0,
              background: 'transparent',
              color: cssVar.colorTextTertiary,
              font: 'inherit',
              cursor: 'not-allowed',
            }}
          >
            <Bot aria-hidden size={18} />
            {t('profile.groupAiUnavailable', { defaultValue: '群聊AI暂不可用，通信管局政策要求' })}
          </button>
          <Flexbox
            horizontal
            align="center"
            gap={16}
            justify="center"
            style={{
              flexWrap: 'wrap',
              maxWidth: '100%',
              padding: 12,
              border: `0.5px solid ${cssVar.colorBorderSecondary}`,
              borderRadius: 12,
              background: cssVar.colorBgContainer,
              boxSizing: 'border-box',
            }}
          >
            <p role="status" style={{ margin: 0, color: cssVar.colorTextSecondary }}>
              {t('profile.phoneRequiredForGroupAi', { defaultValue: '请先绑定手机号码' })}
            </p>
            <Button
              href={withLobeHubMountPath('/settings/profile#profile-phone')}
              icon={<Smartphone aria-hidden size={18} />}
              style={{ minHeight: 40, whiteSpace: 'nowrap' }}
              type="primary"
            >
              {t('profile.bindPhone', { defaultValue: '绑定手机号' })}
            </Button>
          </Flexbox>
        </Flexbox>
      );
    }

    if (isHostedTravelGroup && !runtimeProps)
      return (
        <HostedTravelGroupChatInput
          children={children}
          sendMenuItems={sendMenuItems}
          onBilledSendAccepted={onBilledSendAccepted}
        />
      );

    return (
      <ChatInput
        children={children}
        leftActions={leftActions}
        mentionItems={mentionItems}
        rightActions={rightActions}
        sendMenu={{ items: sendMenuItems }}
        onEditorReady={syncMainInputEditor}
        {...runtimeProps}
      />
    );
  },
);

MainChatInput.displayName = 'MainChatInput';

export default MainChatInput;
