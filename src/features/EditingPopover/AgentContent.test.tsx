import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import AgentContent from './AgentContent';

const mocks = vi.hoisted(() => ({
  refreshAgentList: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/components/EmojiPicker', () => ({ default: () => null }));
vi.mock('@/features/AgentSetting/AgentMeta/BackgroundSwatches', () => ({ default: () => null }));
vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));
vi.mock('@/store/file', () => ({ useFileStore: () => vi.fn() }));
vi.mock('@/store/global', () => ({ useGlobalStore: () => 'zh-CN' }));
vi.mock('@/store/agent', () => ({
  useAgentStore: Object.assign(() => ({ name: '旧名字', title: '旅游顾问' }), {
    getState: () => ({ optimisticUpdateAgentMeta: mocks.update }),
  }),
}));
vi.mock('@/store/home', () => ({
  useHomeStore: {
    getState: () => ({ refreshAgentList: mocks.refreshAgentList, setAgentUpdatingId: vi.fn() }),
  },
}));

it('renames the member without overwriting its role and refreshes the home list', async () => {
  const onClose = vi.fn();
  render(<AgentContent id="agent-a" title="旧名字" onClose={onClose} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '旅游群' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter', keyCode: 13 });
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith('agent-a', { name: '旅游群' });
  expect(mocks.refreshAgentList).toHaveBeenCalledOnce();
});
