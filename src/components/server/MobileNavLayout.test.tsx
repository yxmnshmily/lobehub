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

  it('lets the mobile content column shrink instead of clipping wide descendants', () => {
    const html = renderToStaticMarkup(
      <MobileNavLayout>
        <div>Wide content</div>
      </MobileNavLayout>,
    );

    expect(html).toContain('max-width:100%');
    expect(html).toContain('min-width:0');
    expect(html).toContain('padding-inline:var(--mobile-page-gutter, 10px)');
  });

  it('uses one themed surface behind the header and scroll viewport', () => {
    const html = renderToStaticMarkup(
      <MobileNavLayout header={<header>Header</header>}>
        <main>Content</main>
      </MobileNavLayout>,
    );

    expect(html).toContain('background-color:var(--ant-color-bg-container)');
  });

  it('preserves a custom scroll-container id when a header is present', () => {
    const html = renderToStaticMarkup(
      <MobileNavLayout header={<header>Header</header>} id="discover-scroll">
        <main>Content</main>
      </MobileNavLayout>,
    );

    expect(html).toContain('id="discover-scroll"');
    expect(html).not.toContain('id="lobe-mobile-scroll-container"');
  });
});
