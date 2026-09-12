// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolSettings } from './index';

const responsive = vi.hoisted(() => ({ mobile: false }));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({ detail: 'detail', root: 'root' }),
  useResponsive: () => ({ mobile: responsive.mobile }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', () => ({
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('@/features/Settings/features/SettingsPageHeader', () => ({
  default: ({ title }: { title: string }) => (
    <header data-testid="settings-page-header">{title}</header>
  ),
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: { isMobile: () => false },
  useServerConfigStore: () => false,
}));

vi.mock('@/store/tool', () => ({
  useToolStore: () => [],
}));

vi.mock('@/store/tool/selectors', () => ({
  agentSkillsSelectors: {
    getMarketAgentSkills: () => [],
    getUserAgentSkills: () => [],
  },
  builtinToolSelectors: { installedAllMetaList: () => [] },
}));

vi.mock('./features/LeftPanel', () => ({
  default: ({ onSelect }: { onSelect: (identifier: string, type: 'builtin-skill') => void }) => (
    <button onClick={() => onSelect('builtin-skill', 'builtin-skill')}>tool-list</button>
  ),
}));

vi.mock('./features/SkillDetail', () => ({
  default: ({ identifier }: { identifier: string }) => <div>tool-detail:{identifier}</div>,
}));

describe('ToolSettings responsive header', () => {
  beforeEach(() => {
    responsive.mobile = false;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  it('keeps the desktop settings page header when the route explicitly says desktop', () => {
    responsive.mobile = true;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });

    render(<ToolSettings mobile={false} viewMode="skill" />);

    expect(screen.getByTestId('settings-page-header')).toHaveTextContent('tab.skill');
  });

  it.each(['skill', 'connector'] as const)(
    'does not duplicate the mobile route header on the %s page',
    (viewMode) => {
      render(<ToolSettings mobile viewMode={viewMode} />);

      expect(screen.queryByTestId('settings-page-header')).not.toBeInTheDocument();
    },
  );

  it.each(['skill', 'connector'] as const)(
    'keeps a single-pane list/detail flow with a working return action on mobile %s',
    (viewMode) => {
      render(<ToolSettings mobile viewMode={viewMode} />);

      fireEvent.click(screen.getByRole('button', { name: 'tool-list' }));
      expect(screen.queryByRole('button', { name: 'tool-list' })).not.toBeInTheDocument();
      expect(screen.getByText('tool-detail:builtin-skill')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'back' }));
      expect(screen.getByRole('button', { name: 'tool-list' })).toBeInTheDocument();
      expect(screen.queryByText('tool-detail:builtin-skill')).not.toBeInTheDocument();
    },
  );
});
