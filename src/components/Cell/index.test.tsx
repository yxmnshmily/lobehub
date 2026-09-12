/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import Cell from './index';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({
    align: _align,
    children,
    gap: _gap,
    horizontal: _horizontal,
    justify: _justify,
    padding: _padding,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => null,
}));

describe('Cell', () => {
  it.each(['Enter', ' '])('activates a clickable cell with %s', (key) => {
    const onClick = vi.fn();
    render(<Cell label="应用设置" onClick={onClick} />);

    const cell = screen.getByRole('button', { name: '应用设置' });
    expect(cell).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(cell, { key });

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not expose a non-clickable cell as a button', () => {
    render(<Cell label="只读内容" />);

    expect(screen.queryByRole('button', { name: '只读内容' })).toBeNull();
  });
});
