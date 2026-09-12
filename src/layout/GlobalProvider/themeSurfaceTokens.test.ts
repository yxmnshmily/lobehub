import { describe, expect, it } from 'vitest';

import {
  getMonochromeCustomTheme,
  getThemeSurfaceTokens,
  shouldUseThemeSurfaceTokens,
} from './themeSurfaceTokens';

const relativeLuminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const contrastRatio = (foreground: string, background: string) => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);

  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

describe('getThemeSurfaceTokens', () => {
  it('uses the neutral DeepSeek-style light surface hierarchy', () => {
    const tokens = getThemeSurfaceTokens(false);

    expect(tokens.colorBgLayout).toBe('#f5f6f7');
    expect(tokens.colorBgContainer).toBe('#ffffff');
    expect(tokens.colorText).toBe('#0f1115');
    expect(tokens.colorTextSecondary).toBe('#61666b');
    expect(contrastRatio(tokens.colorTextTertiary, tokens.colorBgLayout)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrastRatio(tokens.colorTextDescription, tokens.colorBgContainer),
    ).toBeGreaterThanOrEqual(4.5);
    expect(tokens.colorBorder).toBe('rgba(15, 17, 21, 0.16)');
    expect(tokens.colorBorderSecondary).toBe('rgba(15, 17, 21, 0.10)');
  });

  it('uses the neutral DeepSeek-style dark surface hierarchy', () => {
    const tokens = getThemeSurfaceTokens(true);

    expect(tokens.colorBgBase).toBe('#151517');
    expect(tokens.colorBgLayout).toBe('#151517');
    expect(tokens.colorBgContainer).toBe('#232324');
    expect(tokens.colorBgElevated).toBe('#2c2c2e');
    expect(tokens.colorText).toBe('#f9fafb');
    expect(tokens.colorBorder).toBe('rgba(255, 255, 255, 0.16)');
    expect(tokens.colorBorderSecondary).toBe('rgba(255, 255, 255, 0.10)');
  });
});

describe('shouldUseThemeSurfaceTokens', () => {
  it('uses the site surface system until the user explicitly picks a neutral palette', () => {
    expect(shouldUseThemeSurfaceTokens(undefined)).toBe(true);
    expect(shouldUseThemeSurfaceTokens('slate')).toBe(false);
  });
});

describe('getMonochromeCustomTheme', () => {
  it('keeps the site accent monochrome while preserving the selected neutral palette', () => {
    expect(getMonochromeCustomTheme('slate', 'mauve')).toEqual({ neutralColor: 'slate' });
    expect(getMonochromeCustomTheme(undefined, 'mauve')).toEqual({ neutralColor: 'mauve' });
  });
});
