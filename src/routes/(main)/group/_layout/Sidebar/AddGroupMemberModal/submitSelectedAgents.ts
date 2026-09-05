interface SubmitSelectedAgentsOptions {
  clearSelection: () => void;
  errorMessage: string;
  notifyError: (message: string) => void;
  onConfirm: (selectedAgentIds: string[]) => Promise<void> | void;
  selectedAgentIds: string[];
}

export const submitSelectedAgents = async ({
  clearSelection,
  errorMessage,
  notifyError,
  onConfirm,
  selectedAgentIds,
}: SubmitSelectedAgentsOptions) => {
  try {
    await onConfirm(selectedAgentIds);
    clearSelection();
  } catch {
    notifyError(errorMessage);
  }
};
