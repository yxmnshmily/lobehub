/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WideScreenContainer from './index';

vi.mock('@/store/global', () => ({
  useGlobalStore: () => false,
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { wideScreen: vi.fn() },
}));

describe('WideScreenContainer mobile gutter', () => {
  it('uses the shared mobile page gutter and preserves the desktop padding token', () => {
    render(
      <WideScreenContainer>
        <div>content</div>
      </WideScreenContainer>,
    );

    const content = screen.getByText('content').parentElement;
    const stylesheet = [...document.querySelectorAll('style')]
      .map((node) => node.textContent)
      .join('\n')
      .replaceAll(/\s/g, '');

    expect(content?.style.getPropertyValue('--wide-screen-container-padding-inline')).toBe('20px');
    expect(stylesheet).toContain(
      'padding-inline:var(--mobile-page-inner-gutter,var(--wide-screen-container-padding-inline,10px))!important',
    );
  });
});
