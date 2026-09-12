/** Resolve at click time, without changing the composer's active topic or scroll position. */
export function getVisibleShareTopicId(trigger: HTMLElement | null): string | undefined {
  const viewport = trigger
    ?.closest('[data-conversation-frame]')
    ?.querySelector<HTMLElement>('[data-conversation-viewport]');
  if (!viewport) return;
  const bounds = viewport.getBoundingClientRect();
  if (bounds.height <= 0 || bounds.width <= 0) return;
  // Match the conversation minimap's reading anchor, rather than offscreen buffered rows.
  const anchor = bounds.top + bounds.height * 0.25;
  let nearest: { distance: number; topicId?: string } | undefined;
  for (const row of viewport.querySelectorAll<HTMLElement>('[data-share-topic-id]')) {
    if (row.closest('[data-conversation-viewport]') !== viewport) continue;
    if (row.parentElement?.closest('[data-share-topic-id]')) continue;
    const rect = row.getBoundingClientRect();
    if (
      rect.bottom <= bounds.top ||
      rect.top >= bounds.bottom ||
      rect.height <= 0 ||
      rect.width <= 0
    )
      continue;
    const distance = Math.max(rect.top - anchor, anchor - rect.bottom, 0);
    if (!nearest || distance < nearest.distance) {
      nearest = { distance, topicId: row.dataset.shareTopicId || undefined };
    }
  }
  // Unknown/unsaved messages must not silently fall back to a different topic.
  return nearest?.topicId;
}
