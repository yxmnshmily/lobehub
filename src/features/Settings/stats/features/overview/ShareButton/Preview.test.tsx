/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import Preview from './Preview';

vi.mock('@lobechat/const', () => ({
  imageUrl: () => '/background.webp',
  OFFICIAL_URL: 'https://app.lobehub.com',
}));

vi.mock('@lobehub/ui', () => ({
  Center: ({ children, className, id, style }: React.ComponentProps<'div'>) => (
    <div className={className} id={id} style={style}>
      {children}
    </div>
  ),
  Flexbox: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
  Grid: ({ children }: React.ComponentProps<'div'>) => <div>{children}</div>,
  lobeStaticStylish: { noScrollbar: 'no-scrollbar' },
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    avatar: 'avatar',
    background: 'background',
    container: 'container',
    decs: 'decs',
    footer: 'footer',
    heatmaps: 'heatmaps',
    preview: 'preview',
    title: 'title',
  }),
  cx: (...classNames: string[]) => classNames.join(' '),
  responsive: { sm: '@media' },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/Branding', () => ({ ProductLogo: () => <div>Logo</div> }));
vi.mock('@/features/User/UserAvatar', () => ({ default: () => <div>Avatar</div> }));
vi.mock('../../visualization/AiHeatmaps', () => ({ default: () => <div>Heatmaps</div> }));
vi.mock('../TotalMessages', () => ({ default: () => <div>Messages</div> }));
vi.mock('../TotalTokens', () => ({ default: () => <div>Tokens</div> }));

describe('stats share preview', () => {
  it('keeps the padded background inside the modal width', () => {
    const { container } = render(<Preview />);

    expect(container.querySelector('#preview')).toHaveStyle({ boxSizing: 'border-box' });
    expect(container.querySelector('.footer')).toHaveStyle({ whiteSpace: 'nowrap' });
  });
});
