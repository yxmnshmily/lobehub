import { useBusinessAgentModeSync } from '@/business/client/hooks/useBusinessAgentMode';
import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';

// Preserve business synchronization while hiding the mode switch.
const ModeSelector = () => {
  const agentId = useAgentId();
  useBusinessAgentModeSync(agentId);
  return null;
};

export default ModeSelector;
