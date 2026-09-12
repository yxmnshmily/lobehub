import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { type VListHandle } from 'virtua';

import { dataSelectors, messageStateSelectors, useConversationStore } from '../../store';
import { isDraftPromotionKey } from '../utils/scrollSnapshotStore';

interface UseConversationScrollOptions {
  autoScrollEnabled?: boolean;
  cancelRestore?: () => void;
  containerRef?: RefObject<HTMLDivElement | null>;
  contextKey?: string;
  dataSource: string[];
  footerOffset?: number;
  headerOffset?: number;
  virtuaRef: RefObject<VListHandle | null>;
}

/** One controller owns bottom following; layout changes never count as user intent. */
export const useConversationScroll = ({
  autoScrollEnabled = true,
  cancelRestore,
  containerRef,
  contextKey = '',
  dataSource,
  footerOffset = 0,
  headerOffset = 0,
  virtuaRef,
}: UseConversationScrollOptions) => {
  const messages = useConversationStore(dataSelectors.displayMessages);
  const isGenerating = useConversationStore(messageStateSelectors.isAIGenerating);
  const followingRef = useRef(false);
  const navigationPausedRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const previousRef = useRef({ contextKey, ids: dataSource });
  const previousOffsetRef = useRef<number | null>(null);
  const latestRef = useRef({ autoScrollEnabled, target: 0 });
  latestRef.current = {
    autoScrollEnabled,
    target: headerOffset + dataSource.length + footerOffset - 1,
  };

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const followBottom = useCallback(
    (force = false) => {
      if (!force && !latestRef.current.autoScrollEnabled) return;
      cancelFrame();
      const scroll = () => {
        frameRef.current = null;
        if (!followingRef.current || (!force && !latestRef.current.autoScrollEnabled)) return;
        if (latestRef.current.target < 0) return;
        virtuaRef.current?.scrollToIndex(latestRef.current.target, { align: 'end', smooth: false });
      };
      if (force) scroll();
      else frameRef.current = requestAnimationFrame(scroll);
    },
    [cancelFrame, virtuaRef],
  );

  const pauseFollowing = useCallback(() => {
    cancelRestore?.();
    navigationPausedRef.current = true;
    followingRef.current = false;
    cancelFrame();
  }, [cancelFrame, cancelRestore]);

  const resumeFollowing = useCallback(() => {
    cancelRestore?.();
    navigationPausedRef.current = false;
    followingRef.current = true;
    previousOffsetRef.current = virtuaRef.current?.scrollOffset ?? null;
    followBottom(true);
  }, [cancelRestore, followBottom, virtuaRef]);

  useLayoutEffect(() => {
    const previous = previousRef.current;
    if (previous.contextKey !== contextKey) {
      cancelFrame();
      navigationPausedRef.current = false;
      if (!isDraftPromotionKey(previous.contextKey, contextKey)) followingRef.current = false;
      previousOffsetRef.current = null;
      previousRef.current = { contextKey, ids: dataSource };
      return;
    }

    // Only an appended user turn is a send: history prepends and optimistic ID
    // replacements must not pull someone away from the messages they are reading.
    const oldTail = previous.ids.at(-1);
    const tailIndex = oldTail ? dataSource.indexOf(oldTail) : -1;
    const appended =
      dataSource.length > previous.ids.length && (!oldTail || tailIndex >= 0)
        ? new Set(dataSource.slice(tailIndex + 1))
        : new Set<string>();
    const sent =
      (previous.ids.length > 0 || isGenerating) &&
      messages.some((message) => message.role === 'user' && appended.has(message.id));
    previousRef.current = { contextKey, ids: dataSource };
    if (sent) resumeFollowing();
    else if (followingRef.current && autoScrollEnabled) followBottom();
  }, [
    autoScrollEnabled,
    cancelFrame,
    contextKey,
    dataSource,
    followBottom,
    isGenerating,
    messages,
    resumeFollowing,
  ]);

  const onScrollOffset = useCallback(
    (offset: number, hasUserIntent = false) => {
      const previous = previousOffsetRef.current;
      previousOffsetRef.current = offset;
      const ref = virtuaRef.current;
      if (!ref) return;
      const atBottom = ref.scrollSize - offset - ref.viewportSize <= 4;
      if (hasUserIntent) {
        navigationPausedRef.current = false;
        cancelRestore?.();
        if (previous !== null && offset < previous) {
          followingRef.current = false;
          cancelFrame();
          return;
        }
        followingRef.current = atBottom;
      } else if (atBottom && !navigationPausedRef.current) {
        followingRef.current = true;
      }
    },
    [cancelFrame, cancelRestore, virtuaRef],
  );

  // Observe virtua's content-height element as well as its viewport. This also
  // covers tool cards, images and workflow collapse without polling each frame.
  useEffect(() => {
    const viewport = containerRef?.current?.querySelector('[data-conversation-viewport]');
    const content = viewport?.firstElementChild;
    if (!viewport || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) followBottom();
    });
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [containerRef, followBottom]);

  useEffect(() => cancelFrame, [cancelFrame]);
  return { onScrollOffset, pauseFollowing, resumeFollowing };
};
