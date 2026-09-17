import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SwrModule from '@/libs/swr';
import { chatGroupService } from '@/services/chatGroup';
import { useAgentGroupStore } from '@/store/agentGroup';

import { GroupDiscussionSettings } from './GroupDiscussionSettings';

vi.mock('@/services/chatGroup', () => ({
  chatGroupService: { updateGroup: vi.fn() },
}));
vi.mock('@/libs/swr', async (importOriginal) => ({
  ...(await importOriginal<typeof SwrModule>()),
  mutate: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useAgentGroupStore.setState({
    activeGroupId: 'other-group',
    groupMap: {
      target: {
        id: 'target',
        agents: [],
        title: 'Test group',
        userId: 'owner',
        createdAt: new Date(),
        updatedAt: new Date(),
        supervisorAgentId: 'supervisor',
        config: { maxDiscussionRounds: 2, openingMessage: 'Keep this opening' },
      },
    },
  });
  vi.mocked(chatGroupService.updateGroup).mockImplementation(async (id, value) => {
    const current = useAgentGroupStore.getState().groupMap[id];
    return { ...current, ...value, config: { ...current.config, ...value.config } } as never;
  });
});

async function chooseThree() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: '3' }));
}

describe('group discussion settings', () => {
  it('saves to the displayed group, preserves its other config, and updates the selected value', async () => {
    render(<GroupDiscussionSettings groupId="target" />);
    await chooseThree();
    await waitFor(() =>
      expect(chatGroupService.updateGroup).toHaveBeenCalledWith('target', {
        config: { maxDiscussionRounds: 3 },
      }),
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('3'));
    expect(useAgentGroupStore.getState().groupMap.target.config?.openingMessage).toBe(
      'Keep this opening',
    );
  });

  it('keeps the saved value and allows retry after a rejected save', async () => {
    vi.mocked(chatGroupService.updateGroup).mockRejectedValueOnce(new Error('offline'));
    render(<GroupDiscussionSettings groupId="target" />);
    await chooseThree();
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('combobox')).toHaveTextContent('2');
    await chooseThree();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('3'));
  });

  it('disables edits while saving and when the existing permission denies edits', async () => {
    let resolve!: () => void;
    vi.mocked(chatGroupService.updateGroup).mockReturnValueOnce(
      new Promise((r) => {
        resolve = () =>
          r({
            ...useAgentGroupStore.getState().groupMap.target,
            config: { maxDiscussionRounds: 3, openingMessage: 'Keep this opening' },
          });
      }) as never,
    );
    const { rerender } = render(<GroupDiscussionSettings groupId="target" />);
    await chooseThree();
    expect(screen.getByRole('combobox')).toBeDisabled();
    await act(async () => resolve());
    rerender(<GroupDiscussionSettings disabled groupId="target" />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
