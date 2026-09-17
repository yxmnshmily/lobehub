import { memo, useLayoutEffect, useRef, useState } from 'react';

import { PortalContent } from '@/features/Portal/router';
import RightPanel from '@/features/RightPanel';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import Conversation from './Conversation';
import { TaskAgentProvider } from './TaskAgentProvider';

interface AgentTaskManagerProps {
  preferredAgentId?: string;
  viewedTaskId?: string;
}

const AgentTaskManager = memo<AgentTaskManagerProps>(({ preferredAgentId, viewedTaskId }) => {
  const [expand, toggleTaskAgentPanel] = useGlobalStore((s) => [
    systemStatusSelectors.showTaskAgentPanel(s),
    s.toggleTaskAgentPanel,
  ]);
  const portalView = useChatStore(chatPortalSelectors.currentViewType);
  const showAcceptance =
    portalView === PortalViewType.Acceptance || portalView === PortalViewType.AcceptanceCheck;
  const isReport = portalView === PortalViewType.Acceptance;
  const workspaceAnchor = useRef<HTMLSpanElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [reportWidth, setReportWidth] = useState(420);
  // Reserve readable space on BOTH sides of the divider. In a narrow workspace
  // keep an equal split instead of allowing either pane to consume the other.
  const paneMinWidth = workspaceWidth ? Math.min(400, workspaceWidth / 2) : 400;
  const paneMaxWidth = workspaceWidth ? workspaceWidth - paneMinWidth : 720;

  useLayoutEffect(() => {
    if (!showAcceptance || !expand) return;
    const workspace = workspaceAnchor.current?.parentElement;
    if (!workspace) return;
    const measure = () => {
      const next = workspace.clientWidth;
      if (!next) return;
      setWorkspaceWidth(next);
      const minimum = Math.min(400, next / 2);
      setReportWidth(isReport ? next / 2 : Math.max(minimum, Math.min(640, next - minimum)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [isReport, showAcceptance, expand]);

  return (
    <>
      <span hidden ref={workspaceAnchor} />
      <RightPanel
        defaultWidth={340}
        expand={expand}
        maxWidth={showAcceptance ? paneMaxWidth : 720}
        minWidth={showAcceptance ? paneMinWidth : 340}
        width={
          showAcceptance ? Math.max(paneMinWidth, Math.min(reportWidth, paneMaxWidth)) : undefined
        }
        onExpandChange={(next) => toggleTaskAgentPanel(next)}
        onSizeChange={
          showAcceptance
            ? (size) => {
                const next = Number.parseFloat(String(size?.width));
                if (Number.isFinite(next))
                  setReportWidth(Math.max(paneMinWidth, Math.min(next, paneMaxWidth)));
              }
            : undefined
        }
      >
        {showAcceptance ? (
          <PortalContent />
        ) : (
          <TaskAgentProvider preferredAgentId={preferredAgentId} viewedTaskId={viewedTaskId}>
            <Conversation />
          </TaskAgentProvider>
        )}
      </RightPanel>
    </>
  );
});

AgentTaskManager.displayName = 'AgentTaskManager';

export default AgentTaskManager;
