import { create } from 'zustand';

interface AgentSelectionState {
  // Actions
  beginSelection: (groupId: string) => void;
  clearSelection: () => void;
  isSelected: (agentId: string) => boolean;
  removeAgent: (agentId: string) => void;
  // State
  selectedAgentIds: string[];
  selectionGroupId?: string;
  setSelectedAgents: (agentIds: string[]) => void;
  toggleAgent: (agentId: string) => void;
}

export const useAgentSelectionStore = create<AgentSelectionState>((set, get) => ({
  beginSelection: (groupId) => {
    set((state) =>
      state.selectionGroupId === groupId
        ? state
        : { selectedAgentIds: [], selectionGroupId: groupId },
    );
  },

  clearSelection: () => {
    set({ selectedAgentIds: [], selectionGroupId: undefined });
  },

  isSelected: (agentId) => {
    return get().selectedAgentIds.includes(agentId);
  },

  removeAgent: (agentId) => {
    set((state) => ({
      selectedAgentIds: state.selectedAgentIds.filter((id) => id !== agentId),
    }));
  },

  selectedAgentIds: [],
  selectionGroupId: undefined,

  setSelectedAgents: (agentIds) => {
    set({ selectedAgentIds: agentIds });
  },

  toggleAgent: (agentId) => {
    set((state) => {
      const isCurrentlySelected = state.selectedAgentIds.includes(agentId);
      if (isCurrentlySelected) {
        return { selectedAgentIds: state.selectedAgentIds.filter((id) => id !== agentId) };
      } else {
        return { selectedAgentIds: [...state.selectedAgentIds, agentId] };
      }
    });
  },
}));
