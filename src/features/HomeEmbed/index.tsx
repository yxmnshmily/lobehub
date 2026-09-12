import { HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useRef } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';

import WorkspaceContextSlot from '@/business/client/WorkspaceContextSlot';
import { ChatInputAutoFocusContext } from '@/features/ChatInput/components/AutoFocusContext';
import { DndContextWrapper } from '@/features/ResourceManager/DndContextWrapper';

import WorkGroupHome from './WorkGroupHome';

const styles = createStaticStyles(({ css }) => ({
  viewport: css`
    overflow: hidden;
    overscroll-behavior-x: contain;

    width: 100%;
    height: auto;
    min-height: 0;
  `,
  content: css`
    box-sizing: border-box;
    width: 100%;
    padding: 24px;

    @media (width <= 600px) {
      padding-block: 16px;
      padding-inline: 8px;
    }
  `,
}));

// Borrow the dashboard layout, but bind its composer to the account's work group.
const HomeEmbed = memo(() => {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const content = contentRef.current;
    if (!content || window.parent === window) return;
    const parentOrigin = document.referrer
      ? new URL(document.referrer).origin
      : window.location.origin;
    const reportHeight = () => {
      window.parent.postMessage(
        { type: 'travel-home:height', height: Math.ceil(content.getBoundingClientRect().height) },
        parentOrigin,
      );
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === window.parent &&
        event.origin === parentOrigin &&
        event.data?.type === 'travel-home:measure'
      )
        reportHeight();
    };
    const onWheel = (event: WheelEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      // Preserve editor/menu scrolling; only hand unused vertical gestures out
      // of the iframe, whose document otherwise traps them in some browsers.
      let node = event.target instanceof Element ? event.target : null;
      if (node?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      while (node && node !== document.body && node !== document.documentElement) {
        const { overflowY } = getComputedStyle(node);
        if (
          ['auto', 'scroll'].includes(overflowY) &&
          node.scrollHeight > node.clientHeight + 1 &&
          (event.deltaY < 0
            ? node.scrollTop > 0
            : node.scrollTop + node.clientHeight < node.scrollHeight - 1)
        )
          return;
        node = node.parentElement;
      }
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      window.parent.postMessage(
        { type: 'travel-home:scroll', deltaY: event.deltaY * unit },
        parentOrigin,
      );
    };
    const observer = new ResizeObserver(reportHeight);
    observer.observe(content);
    window.addEventListener('message', onMessage);
    document.addEventListener('wheel', onWheel, { passive: false });
    reportHeight();
    return () => {
      observer.disconnect();
      window.removeEventListener('message', onMessage);
      document.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <HotkeysProvider initiallyActiveScopes={[HotkeyScopeEnum.Global]}>
      <style>{`
        html:has([data-home-embed]),
        body:has([data-home-embed]),
        #__next:has([data-home-embed]) {
          overflow-y: auto;
          overscroll-behavior-y: auto;
        }
      `}</style>
      <WorkspaceContextSlot>
        <DndContextWrapper>
          <div className={styles.viewport} data-home-embed="">
            <div className={styles.content} ref={contentRef}>
              <ChatInputAutoFocusContext value={false}>
                <WorkGroupHome />
              </ChatInputAutoFocusContext>
            </div>
          </div>
        </DndContextWrapper>
      </WorkspaceContextSlot>
    </HotkeysProvider>
  );
});

export default HomeEmbed;
