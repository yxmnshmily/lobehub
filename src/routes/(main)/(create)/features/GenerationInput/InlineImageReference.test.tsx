import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InlineImageReference from './InlineImageReference';

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useResponsive: () => ({ mobile: true }),
}));

vi.mock('./UploadCard', () => ({
  default: ({ imageUrl, style }: { imageUrl?: string; style?: React.CSSProperties }) => (
    <div data-testid="reference" data-url={imageUrl} style={style} />
  ),
  UPLOAD_CARD_SIZE: 64,
}));

describe('InlineImageReference', () => {
  it('does not hide earlier references in a hover-only stack on mobile', () => {
    render(
      <InlineImageReference
        images={['/one.png', '/two.png']}
        maxCount={2}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId('reference')[1]).toHaveStyle({ marginInlineStart: '4px' });
  });
});
