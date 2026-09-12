import type { NeutralColors } from '@lobehub/ui';

const lightSurfaceTokens = {
  colorBgBase: '#ffffff',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBgLayout: '#f5f6f7',
  colorBorder: 'rgba(15, 17, 21, 0.16)',
  colorBorderSecondary: 'rgba(15, 17, 21, 0.10)',
  colorFillSecondary: 'rgba(15, 17, 21, 0.06)',
  colorFillTertiary: 'rgba(15, 17, 21, 0.04)',
  colorSplit: 'rgba(15, 17, 21, 0.10)',
  colorText: '#0f1115',
  colorTextDescription: '#6b7077',
  colorTextSecondary: '#61666b',
  colorTextTertiary: '#6b7077',
} as const;

const darkSurfaceTokens = {
  colorBgBase: '#151517',
  colorBgContainer: '#232324',
  colorBgElevated: '#2c2c2e',
  colorBgLayout: '#151517',
  colorBorder: 'rgba(255, 255, 255, 0.16)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.10)',
  colorFillSecondary: 'rgba(255, 255, 255, 0.10)',
  colorFillTertiary: 'rgba(255, 255, 255, 0.06)',
  colorSplit: 'rgba(255, 255, 255, 0.10)',
  colorText: '#f9fafb',
  colorTextDescription: '#adb2b8',
  colorTextSecondary: '#cfd3d6',
  colorTextTertiary: '#adb2b8',
} as const;

export const getThemeSurfaceTokens = (isDark: boolean) =>
  isDark ? darkSurfaceTokens : lightSurfaceTokens;

export const shouldUseThemeSurfaceTokens = (userNeutralColor?: string) => !userNeutralColor;

export const getMonochromeCustomTheme = (
  neutralColor?: NeutralColors,
  defaultNeutralColor?: NeutralColors,
) => ({ neutralColor: neutralColor ?? defaultNeutralColor });
