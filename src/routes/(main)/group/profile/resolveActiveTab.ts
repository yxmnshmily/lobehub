export const resolveActiveTab = (activeTabId: string, currentGroupAgentIds: string[]) => {
  if (activeTabId === 'group' || currentGroupAgentIds.includes(activeTabId)) return activeTabId;

  return 'group';
};
