import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import MobileNavLayout from './MobileNavLayout';

describe('MobileNavLayout', () => {
  it('keeps nav content above the mobile bottom safe area', () => {
    const html = renderToStaticMarkup(
      <MobileNavLayout withNav>
        <div>Last item</div>
      </MobileNavLayout>,
    );

    expect(html).toContain('padding-bottom:calc(48px + env(safe-area-inset-bottom))');
  });
});
