import { describe, expect, it } from 'vitest';

import { resolveResourceSkeletonView } from './skeletonView';

describe('resolveResourceSkeletonView', () => {
  it.each([
    ['/resource/files', null, 'works'],
    ['/resource/other', null, 'works'],
    ['/resource/audios', null, 'works'],
    ['/resource/images', null, 'masonry'],
    ['/resource/images', 'list', 'list'],
    ['/resource/works', null, 'works'],
  ])('uses the settled view for %s', (pathname, requestedView, expected) => {
    expect(resolveResourceSkeletonView(pathname, requestedView)).toBe(expected);
  });
});
