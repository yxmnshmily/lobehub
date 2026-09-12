import type { MouseEvent } from 'react';

/** The resizable body extends beyond the contenteditable's text rows. */
export function focusEditorOnBodyClick(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  // Let native caret placement, selections and embedded controls handle their own clicks.
  if (target.closest('[contenteditable], button, a, input, textarea, select, [role="button"]'))
    return;
  event.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
}
