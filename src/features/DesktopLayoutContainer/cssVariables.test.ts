import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDarwinMajorVersion, isMacOSWithLargeWindowBorders } from '@/utils/platform';

import { getInnerCssVariables, getOuterCssVariables } from './cssVariables';

const platform = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@/const/version', () => ({
  get isDesktop() {
    return platform.isDesktop;
  },
}));

vi.mock('@/utils/platform', () => ({
  getDarwinMajorVersion: vi.fn(() => 0),
  isMacOSWithLargeWindowBorders: vi.fn(() => false),
}));

const mockDarwin = vi.mocked(getDarwinMajorVersion);
const mockLargeBorders = vi.mocked(isMacOSWithLargeWindowBorders);

beforeEach(() => {
  platform.isDesktop = false;
  mockDarwin.mockReturnValue(0);
  mockLargeBorders.mockReturnValue(false);
});

describe('getOuterCssVariables', () => {
  it('keeps a stable gutter around the content surface in both nav states', () => {
    expect(getOuterCssVariables({ expand: true })['--container-padding-left']).toBe('12px');
    expect(getOuterCssVariables({ expand: false })['--container-padding-left']).toBe('12px');
    expect(getOuterCssVariables({ expand: true })['--container-padding-top']).toBe('12px');
  });

  it('preserves the native desktop window gutters', () => {
    platform.isDesktop = true;

    expect(getOuterCssVariables({ expand: true })['--container-padding-left']).toBe('0px');
    expect(getOuterCssVariables({ expand: false })['--container-padding-left']).toBe('8px');
    expect(getOuterCssVariables({ expand: true })['--container-padding-top']).toBe('0px');
  });
});

describe('getInnerCssVariables', () => {
  it('uses the 16px web surface radius', () => {
    const vars = getInnerCssVariables({ isDark: false });

    expect(vars['--container-border-radius']).toBe('16px');
    expect(vars['--container-border-bottom-right-radius']).toBe('16px');
  });

  it('preserves native desktop radii across macOS window styles', () => {
    platform.isDesktop = true;
    mockDarwin.mockReturnValue(24);

    expect(getInnerCssVariables({ isDark: false })['--container-border-radius']).toBe(
      'var(--ant-border-radius)',
    );

    mockDarwin.mockReturnValue(25);
    expect(getInnerCssVariables({ isDark: false })['--container-border-radius']).toBe('12px');

    mockDarwin.mockReturnValue(24);
    mockLargeBorders.mockReturnValue(true);
    expect(getInnerCssVariables({ isDark: false })['--container-border-bottom-right-radius']).toBe(
      '12px',
    );
  });

  it('softens the border color in dark mode', () => {
    expect(getInnerCssVariables({ isDark: true })['--container-border-color']).toBe(
      'var(--ant-color-border-secondary)',
    );
    expect(getInnerCssVariables({ isDark: false })['--container-border-color']).toBe(
      'var(--ant-color-border)',
    );
  });
});
