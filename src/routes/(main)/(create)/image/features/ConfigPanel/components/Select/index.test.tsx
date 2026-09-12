/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SizeSelect from './index';

vi.mock('@/hooks/useIsDark', () => ({ useIsDark: () => false }));

describe('image size selector', () => {
  it('keeps resolution labels on one line on narrow screens', () => {
    render(
      <SizeSelect
        options={[
          { label: '1024x1024', value: '1024x1024' },
          { label: '2160x3840', value: '2160x3840' },
        ]}
      />,
    );

    expect(screen.getByText('1024x1024')).toHaveStyle({ whiteSpace: 'nowrap' });
    expect(screen.getByText('2160x3840')).toHaveStyle({ whiteSpace: 'nowrap' });
  });
});
