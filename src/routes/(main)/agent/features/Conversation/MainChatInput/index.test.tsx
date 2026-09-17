import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MainChatInput from './index';

vi.mock('@/features/Conversation', () => ({
  ChatInput: ({ leftContent, leftActions }: any) => (
    <div>
      {leftContent ?? leftActions.map((action: string) => <button key={action}>{action}</button>)}
    </div>
  ),
}));
vi.mock('@/features/Conversation/store', () => ({
  contextSelectors: { agentId: () => 'coordinator' },
  useConversationStore: (selector: any) => selector({}),
}));
vi.mock('@/store/agent', () => ({ useAgentStore: (selector: any) => selector({}) }));
vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentModelById: () => () => 'model',
    getAgentModelProviderById: () => () => 'provider',
    isAgentConfigLoadingById: () => () => false,
  },
}));
vi.mock('@/store/user', () => ({ useUserStore: (selector: any) => selector({}) }));
vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: { config: () => ({ isDevMode: false }) },
}));
vi.mock('@/store/chat', () => ({ useChatStore: { setState: vi.fn() } }));
vi.mock('@/hooks/useModelSupportImageOutput', () => ({ useModelSupportImageOutput: () => false }));
vi.mock('./AgentConfigError', () => ({ default: () => null }));
vi.mock('./useSendMenuItems', () => ({ useSendMenuItems: () => [] }));
// Keep the production ActionBar: only isolate its store and final visual renderer.
vi.mock('@/features/ChatInput/store', () => ({
  useChatInputStore: (selector: any) =>
    selector({ leftActions: ['plus', 'voiceDictation'], mobile: false }),
}));
vi.mock('@/features/ChatInput/hooks/useChatInputResourceAccess', () => ({
  useChatInputResourceAccess: () => ({ canConfigureResource: true, canShowControls: true }),
}));
vi.mock('@/features/ChatInput/ActionBar/config', () => ({
  actionMap: {
    plus: () => <button>上传与工具</button>,
    voiceDictation: () => <button>语音输入</button>,
  },
}));
vi.mock('@/features/ChatInput/ActionBar/Toolbar', () => ({
  default: ({ items }: any) => (
    <>
      {items.map((item: any) => (
        <span key={item.key}>{item.children}</span>
      ))}
    </>
  ),
}));

describe('project assistant composer actions', () => {
  it('retains upload and dictation alongside the project assistant', () => {
    render(<MainChatInput leftContent={<button>项目助手</button>} />);
    expect(screen.getByRole('button', { name: '项目助手' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上传与工具' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '语音输入' })).toBeTruthy();
  });
});
