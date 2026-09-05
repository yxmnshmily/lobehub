import { describe, expect, it, vi } from 'vitest';

import { submitSelectedAgents } from './submitSelectedAgents';

describe('submitSelectedAgents', () => {
  it('keeps the selection and reports a generic error when adding fails', async () => {
    const clearSelection = vi.fn();
    const notifyError = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('internal database detail'));

    await submitSelectedAgents({
      clearSelection,
      errorMessage: 'operationFailed',
      notifyError,
      onConfirm,
      selectedAgentIds: ['agent-a'],
    });

    expect(clearSelection).not.toHaveBeenCalled();
    expect(notifyError).toHaveBeenCalledWith('operationFailed');
    expect(notifyError).not.toHaveBeenCalledWith('internal database detail');
  });
});
