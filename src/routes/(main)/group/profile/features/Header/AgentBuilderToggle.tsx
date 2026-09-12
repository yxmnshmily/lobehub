import { ActionIcon } from '@lobehub/ui/base-ui';
import { BotMessageSquareIcon } from 'lucide-react';
import { memo } from 'react';

import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useGroupProfileStore } from '@/store/groupProfile';

const AgentBuilderToggle = memo(() => {
  const chatPanelExpanded = useGroupProfileStore((s) => s.chatPanelExpanded);
  const setChatPanelExpanded = useGroupProfileStore((s) => s.setChatPanelExpanded);

  return (
    <ActionIcon
      active={chatPanelExpanded}
      aria-label="智能体构建助手"
      icon={BotMessageSquareIcon}
      size={DESKTOP_HEADER_ICON_SIZE}
      title="智能体构建助手"
      onClick={() => setChatPanelExpanded((prev) => !prev)}
    />
  );
});

export default AgentBuilderToggle;
