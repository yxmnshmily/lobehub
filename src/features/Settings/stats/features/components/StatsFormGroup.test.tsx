/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StatsFormGroup from './StatsFormGroup';

let mobile = false;

vi.mock('@lobehub/ui', () => ({
  Block: ({ children, style }: ComponentProps<'section'>) => (
    <section style={style}>{children}</section>
  ),
  Flexbox: ({
    children,
    horizontal,
    style,
  }: ComponentProps<'div'> & { horizontal?: boolean }) => (
    <div style={{ display: 'flex', flexDirection: horizontal ? 'row' : 'column', ...style }}>
      {children}
    </div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Text: ({ children }: ComponentProps<'span'>) => <span>{children}</span>,
}));

vi.mock('antd-style', () => ({
  useResponsive: () => ({ mobile }),
}));

describe('StatsFormGroup', () => {
  beforeEach(() => {
    mobile = false;
  });

  it('keeps the mobile title and expand action in one horizontal header row', () => {
    mobile = true;

    render(
      <StatsFormGroup extra={<button type="button">展开</button>} title={'话题内容量'}>
        <div>内容</div>
      </StatsFormGroup>,
    );

    const title = screen.getByText('话题内容量');
    const header = title.parentElement;

    expect(header).toHaveStyle({ flexDirection: 'row' });
    expect(header).toHaveStyle({ minWidth: '0', width: '100%' });
    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument();
  });

  it('lets ranking content shrink inside a narrow grid cell', () => {
    render(
      <StatsFormGroup title={'模型排行榜'}>
        <div data-testid="ranking">排行内容</div>
      </StatsFormGroup>,
    );

    expect(screen.getByTestId('ranking').parentElement).toHaveStyle({
      maxWidth: '100%',
      minWidth: '0',
      width: '100%',
    });
  });

  it('moves a title above the controls when both a switcher and status tags are present', () => {
    mobile = true;

    render(
      <StatsFormGroup afterTitle={<button type="button">Tokens</button>} extra={<span>7 天</span>} title={'过去一年活跃度'}>
        <div>热力图</div>
      </StatsFormGroup>,
    );

    const title = screen.getByText('过去一年活跃度');
    expect(title.parentElement).toHaveStyle({ flexDirection: 'column', width: '100%' });
    expect(screen.getByRole('button', { name: 'Tokens' }).parentElement).toHaveStyle({
      flexWrap: 'wrap',
      minWidth: '0',
    });
  });
});
