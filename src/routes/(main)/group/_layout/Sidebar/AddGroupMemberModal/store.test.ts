import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentSelectionStore } from './store';

describe('useAgentSelectionStore', () => {
  beforeEach(() => {
    useAgentSelectionStore.setState({ selectedAgentIds: [], selectionGroupId: undefined });
  });

  it('preserves selection for the same group and clears it when the target group changes', () => {
    useAgentSelectionStore.getState().beginSelection('group-a');
    useAgentSelectionStore.getState().setSelectedAgents(['agent-a']);

    useAgentSelectionStore.getState().beginSelection('group-a');
    expect(useAgentSelectionStore.getState().selectedAgentIds).toEqual(['agent-a']);

    useAgentSelectionStore.getState().beginSelection('group-b');
    expect(useAgentSelectionStore.getState().selectedAgentIds).toEqual([]);
  });
});
