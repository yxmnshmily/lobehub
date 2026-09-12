'use client';

import { HotkeyEnum, KeyEnum } from '@lobechat/const/hotkeys';
import { type MenuProps } from '@lobehub/ui';
import { Flexbox, Hotkey, Icon } from '@lobehub/ui';
import { BotMessageSquare, LucideCheck, MessageSquarePlus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useConversationStore, useConversationStoreApi } from '@/features/Conversation';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { preferenceSelectors, settingsSelectors } from '@/store/user/selectors';

/**
 * useSendMenuItems hook for ConversationStore
 *
 * Provides send menu items for:
 * - Send with Enter / Cmd+Enter toggle
 * - Add AI Message
 * - Add User Message
 */
export const useSendMenuItems = (): MenuProps['items'] => {
  const { t } = useTranslation('chat');

  const storeApi = useConversationStoreApi();
  const editor = useConversationStore((s) => s.editor);
  const hasAuthorizedTransport = useConversationStore((s) => !!s.hooks?.onSendMessage);

  const [useCmdEnterToSend, updatePreference] = useUserStore((s) => [
    preferenceSelectors.useCmdEnterToSend(s),
    s.updatePreference,
  ]);

  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.AddUserMessage));

  const handleAddAIMessage = useCallback(() => {
    const store = storeApi.getState();
    const message = editor?.getMarkdownContent() ?? store.inputMessage;
    store.addAIMessage(message);
    // Clear and focus editor
    editor?.clearContent();
    editor?.focus();
  }, [storeApi, editor]);

  const handleAddUserMessage = useCallback(async () => {
    const store = storeApi.getState();
    const message = editor?.getMarkdownContent() ?? store.inputMessage;
    const fileStore = useFileStore.getState();
    const files = fileChatSelectors.chatUploadFileList(fileStore);
    if (fileChatSelectors.isUploadingFiles(fileStore) || (!message.trim() && !files.length)) return;
    const contextKey = messageMapKey(store.context);

    const accepted = await store.addUserMessage({
      message: message.trim() || '附件',
      ...(files.length ? { fileList: files.map((file) => file.id) } : {}),
    });
    if (!accepted) return;
    if (messageMapKey(storeApi.getState().context) !== contextKey) return;
    // Clear and focus editor
    if (editor?.getMarkdownContent() === message) editor.clearContent();
    const latestFiles = fileChatSelectors.chatUploadFileList(useFileStore.getState());
    if (
      latestFiles.length === files.length &&
      latestFiles.every((file, index) => file.id === files[index].id)
    )
      fileStore.clearChatUploadFileList();
    editor?.focus();
  }, [storeApi, editor]);

  return useMemo(
    () =>
      [
        {
          icon: !useCmdEnterToSend ? <Icon icon={LucideCheck} /> : <div />,
          key: 'sendWithEnter',
          label: (
            <Flexbox horizontal align={'center'} gap={4}>
              <Trans
                i18nKey={'input.sendWithEnter'}
                ns={'chat'}
                components={{
                  key: <Hotkey keys={KeyEnum.Enter} variant={'borderless'} />,
                }}
              />
            </Flexbox>
          ),
          onClick: () => {
            updatePreference({ useCmdEnterToSend: false });
          },
        },
        {
          icon: useCmdEnterToSend ? <Icon icon={LucideCheck} /> : <div />,
          key: 'sendWithCmdEnter',
          label: (
            <Flexbox horizontal align={'center'} gap={4}>
              <Trans
                i18nKey={'input.sendWithCmdEnter'}
                ns={'chat'}
                components={{
                  key: (
                    <Hotkey keys={[KeyEnum.Mod, KeyEnum.Enter].join('+')} variant={'borderless'} />
                  ),
                }}
              />
            </Flexbox>
          ),
          onClick: () => {
            updatePreference({ useCmdEnterToSend: true });
          },
        },
        { type: 'divider' as const },
        {
          icon: <Icon icon={BotMessageSquare} />,
          key: 'addAi',
          label: t('input.addAi'),
          onClick: handleAddAIMessage,
        },
        {
          icon: <Icon icon={MessageSquarePlus} />,
          key: 'addUser',
          label: (
            <Flexbox horizontal align={'center'} gap={24}>
              {t('input.addUser')}
              <Hotkey keys={hotkey} />
            </Flexbox>
          ),
          onClick: handleAddUserMessage,
        },
      ].filter((item) => !hasAuthorizedTransport || item.key !== 'addAi'),
    [
      t,
      hasAuthorizedTransport,
      useCmdEnterToSend,
      updatePreference,
      hotkey,
      handleAddAIMessage,
      handleAddUserMessage,
    ],
  );
};
