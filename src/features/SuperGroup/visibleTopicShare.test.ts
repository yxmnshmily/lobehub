/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getVisibleShareTopicId } from './visibleTopicShare';

function rect(element: Element, top: number, bottom: number, width = 600) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom,
    height: bottom - top,
    width,
  } as DOMRect);
}

function setup() {
  const frame = document.createElement('div');
  frame.setAttribute('data-conversation-frame', '');
  const trigger = frame.appendChild(document.createElement('button'));
  const viewport = frame.appendChild(document.createElement('div'));
  viewport.setAttribute('data-conversation-viewport', '');
  rect(viewport, 100, 500);
  document.body.append(frame);
  const row = (topic: string, top: number, bottom: number) => {
    const element = viewport.appendChild(document.createElement('div'));
    element.dataset.shareTopicId = topic;
    rect(element, top, bottom);
    return element;
  };
  return { trigger, viewport, row };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('visible topic share selection', () => {
  it('ignores virtual-list buffers and picks the reading anchor, not the latest topic', () => {
    const { trigger, row } = setup();
    row('buffer-before', -500, 80);
    row('yesterday', 80, 350);
    row('today', 350, 700);
    row('buffer-after', 700, 1200);
    expect(getVisibleShareTopicId(trigger)).toBe('yesterday');
  });

  it('uses the nearest visible message when the anchor is in spacing', () => {
    const { trigger, row } = setup();
    row('older', 90, 150);
    row('newer', 210, 600);
    expect(getVisibleShareTopicId(trigger)).toBe('newer');
  });

  it('does not fall back to another topic when the visible row is unsaved', () => {
    const { trigger, row } = setup();
    row('', 100, 350);
    row('latest', 350, 600);
    expect(getVisibleShareTopicId(trigger)).toBeUndefined();
  });

  it('isolates other frames and nested thread viewports', () => {
    const other = setup();
    other.row('other-group', 100, 500);
    const { trigger, row } = setup();
    const main = row('main-topic', 100, 500);
    const nested = main.appendChild(document.createElement('div'));
    nested.dataset.shareTopicId = 'thread-topic';
    rect(nested, 190, 300);
    expect(getVisibleShareTopicId(trigger)).toBe('main-topic');
  });

  it('fails closed for a missing or hidden viewport', () => {
    expect(getVisibleShareTopicId(null)).toBeUndefined();
    const { trigger, row, viewport } = setup();
    row('topic', 100, 500);
    rect(viewport, 100, 100);
    expect(getVisibleShareTopicId(trigger)).toBeUndefined();
  });
});
