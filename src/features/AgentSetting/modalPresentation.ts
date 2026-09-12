import { cssVar } from 'antd-style';

export const settingsModalNavigationPresentation = {
  desktopDirection: 'row',
  mobileBreakpoint: 768,
  mobileDirection: 'column',
  sidebarWidth: 184,
} as const;

export const agentSettingsModalPresentation = {
  styles: {
    content: {
      background: cssVar.colorBgElevated,
      borderRadius: 20,
      boxShadow: cssVar.boxShadow,
      height: 'min(800px, calc(100dvh - 32px))',
      isolation: 'isolate',
      overflow: 'hidden',
      padding: 0,
      position: 'relative',
    },
    header: { display: 'none' },
  },
  width: 'min(800px, calc(100vw - 32px))',
} as const;
