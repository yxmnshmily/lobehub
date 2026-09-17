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

// Semantic errors keep a restrained red hue across menus, buttons and validation.
// Override the full scale so hover/background states do not retain the UI kit's pink.
export const getThemeErrorTokens = (isDark: boolean) => {
  const color = isDark ? '#e58b86' : '#ad4742';
  const hover = isDark ? '#eea39e' : '#a8433e';
  const active = isDark ? '#e08a84' : '#963b36';
  return {
    colorError: color,
    colorErrorActive: active,
    colorErrorBg: isDark ? '#342829' : '#fcf4f3',
    colorErrorBgHover: isDark ? '#423031' : '#f8e9e7',
    colorErrorBorder: isDark ? '#704b49' : '#e7bcb8',
    colorErrorBorderHover: isDark ? '#91615d' : '#d79690',
    colorErrorFill: isDark ? 'rgba(229, 139, 134, 0.22)' : 'rgba(173, 71, 66, 0.18)',
    colorErrorFillSecondary: isDark ? 'rgba(229, 139, 134, 0.16)' : 'rgba(173, 71, 66, 0.12)',
    colorErrorFillTertiary: isDark ? 'rgba(229, 139, 134, 0.10)' : 'rgba(173, 71, 66, 0.08)',
    colorErrorFillQuaternary: isDark ? 'rgba(229, 139, 134, 0.06)' : 'rgba(173, 71, 66, 0.04)',
    colorErrorHover: hover,
    colorErrorText: color,
    colorErrorTextActive: active,
    colorErrorTextHover: hover,
  };
};
