import { act, renderHook } from '@testing-library/react';
import { type TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRemoveGroupMember } from './useRemoveGroupMember';

const t = ((key: string) => key) as TFunction<'chat'>;

describe('useRemoveGroupMember', () => {
  const notifyError = vi.fn();
  const removeAgentFromGroup = vi.fn();
  const requestConfirmation = vi.fn();

  beforeEach(() => {
    notifyError.mockReset();
    removeAgentFromGroup.mockReset();
    requestConfirmation.mockReset();
  });

  it('requires confirmation before removing a member', async () => {
    const { result } = renderHook(() =>
      useRemoveGroupMember({
        canEdit: true,
        groupId: 'group-a',
        notifyError,
        removeAgentFromGroup,
        requestConfirmation,
        t,
      }),
    );

    act(() => result.current.confirmRemoveMember('member-a', '西藏文案助理'));

    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(removeAgentFromGroup).not.toHaveBeenCalled();

    await act(() => requestConfirmation.mock.calls[0][0].onOk());

    expect(removeAgentFromGroup).toHaveBeenCalledWith('group-a', 'member-a');
  });

  it('reports a generic failure without leaking internal details', async () => {
    removeAgentFromGroup.mockRejectedValueOnce(new Error('internal database detail'));
    const { result } = renderHook(() =>
      useRemoveGroupMember({
        canEdit: true,
        groupId: 'group-a',
        notifyError,
        removeAgentFromGroup,
        requestConfirmation,
        t,
      }),
    );

    act(() => result.current.confirmRemoveMember('member-a', '西藏文案助理'));
    await act(() => requestConfirmation.mock.calls[0][0].onOk());

    expect(notifyError).toHaveBeenCalledWith('operationFailed');
    expect(notifyError).not.toHaveBeenCalledWith('internal database detail');
  });

  it('does not expose the operation when editing is forbidden', () => {
    const { result } = renderHook(() =>
      useRemoveGroupMember({
        canEdit: false,
        groupId: 'group-a',
        notifyError,
        removeAgentFromGroup,
        requestConfirmation,
        t,
      }),
    );

    act(() => result.current.confirmRemoveMember('member-a', '西藏文案助理'));

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(removeAgentFromGroup).not.toHaveBeenCalled();
  });
});
