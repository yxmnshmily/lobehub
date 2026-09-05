'use client';

import { useEditor, useEditorState } from '@lobehub/editor/react';
import { useUnmount } from 'ahooks';
import { memo, useEffect } from 'react';
import { useParams } from 'react-router';
import { createStoreUpdater } from 'zustand-utils';

import { useRegisterFilesHotkeys, useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { parseAsString, useQueryState } from '@/hooks/useQueryParam';
import { useAgentGroupStore } from '@/store/agentGroup';
import { agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useChatStore } from '@/store/chat';
import { useGroupProfileStore } from '@/store/groupProfile';

import { resolveActiveTab } from './resolveActiveTab';

const StoreSync = memo(() => {
  const { gid } = useParams<{ gid: string }>();
  const editor = useEditor();
  const editorState = useEditorState(editor);
  const flushSave = useGroupProfileStore((s) => s.flushSave);

  const storeUpdater = createStoreUpdater(useGroupProfileStore);

  // Sync editor to store
  storeUpdater('editor', editor);
  // Sync editorState to store
  storeUpdater('editorState', editorState);
  // Sync tab query param to store
  const [activeTabId, setActiveTabId] = useQueryState('tab', parseAsString.withDefault('group'));
  const currentGroup = useAgentGroupStore((s) => agentGroupSelectors.getGroupById(gid ?? '')(s));
  const currentGroupAgentIds = useAgentGroupStore((s) =>
    agentGroupSelectors
      .getGroupAgents(gid ?? '')(s)
      .map((agent) => agent.id),
  );
  const safeActiveTabId = currentGroup
    ? resolveActiveTab(activeTabId, currentGroupAgentIds)
    : activeTabId;
  storeUpdater('activeTabId', safeActiveTabId);

  useEffect(() => {
    if (safeActiveTabId !== activeTabId) void setActiveTabId(safeActiveTabId);
  }, [activeTabId, safeActiveTabId, setActiveTabId]);

  // Sync URL query 'bt' → chatStore.activeTopicId (one-way only)
  // Store → URL sync is handled directly by TopicSelector using setBuilderTopicId
  const [builderTopicId] = useQueryState('bt');

  useEffect(() => {
    const urlTopicId = builderTopicId ?? undefined;
    useChatStore.setState({ activeTopicId: urlTopicId });

    return () => {
      // Clear activeTopicId when unmounting (leaving group profile page)
      useChatStore.setState({ activeTopicId: undefined }, false, 'GroupProfileUnmounted');
    };
  }, [builderTopicId]);

  // Register hotkeys
  useRegisterFilesHotkeys();
  useSaveDocumentHotkey(flushSave);

  // Clear state when unmounting
  useUnmount(() => {
    useGroupProfileStore.setState(
      {
        activeTabId: 'group',
        editor: undefined,
        editorState: undefined,
        saveStateMap: {},
      },
      false,
      'GroupProfileUnmounted',
    );
  });

  return null;
});

export default StoreSync;
