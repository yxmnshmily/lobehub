import { describe, expect, it } from 'vitest';

import {
  agentSettingsModalPresentation,
  settingsModalNavigationPresentation,
} from './modalPresentation';

describe('agentSettingsModalPresentation', () => {
  it('keeps the settings dialog inside narrow and short viewports', () => {
    expect(agentSettingsModalPresentation.width).toBe('min(800px, calc(100vw - 32px))');
    expect(agentSettingsModalPresentation.styles.content.height).toBe(
      'min(800px, calc(100dvh - 32px))',
    );
  });

  it('leaves scrolling to the settings content instead of the modal shell', () => {
    expect(agentSettingsModalPresentation.styles.content.overflow).toBe('hidden');
  });

  it('uses a deliberate rounded surface instead of the default modal rectangle', () => {
    expect(agentSettingsModalPresentation.styles.content.borderRadius).toBe(20);
    expect(agentSettingsModalPresentation.styles.content.isolation).toBe('isolate');
  });

  it('uses a desktop side navigation that collapses to a mobile tab row', () => {
    expect(settingsModalNavigationPresentation.sidebarWidth).toBe(184);
    expect(settingsModalNavigationPresentation.mobileBreakpoint).toBe(768);
    expect(settingsModalNavigationPresentation.desktopDirection).toBe('row');
    expect(settingsModalNavigationPresentation.mobileDirection).toBe('column');
  });
});
