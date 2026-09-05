import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DiscreteSlider from './index';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ref }: { children: React.ReactNode; ref?: React.Ref<HTMLDivElement> }) => (
    <div ref={ref}>{children}</div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Slider: () => <input data-testid="slider" type="range" />,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

describe('DiscreteSlider', () => {
  it('gives the generated range input an accessible name', () => {
    render(<DiscreteSlider ariaLabel="字号" options={[{ label: 'A', value: 12 }]} value={12} />);

    expect(screen.getByTestId('slider')).toHaveAttribute('aria-label', '字号');
  });
});
