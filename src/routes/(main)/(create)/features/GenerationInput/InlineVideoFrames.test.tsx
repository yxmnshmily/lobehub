import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InlineVideoFrames from './InlineVideoFrames';

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useResponsive: () => ({ mobile: true }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./UploadCard', () => ({
  default: ({ imageUrl, style }: { imageUrl?: string; style?: React.CSSProperties }) => (
    <div data-testid="reference" data-url={imageUrl} style={style} />
  ),
  UPLOAD_CARD_SIZE: 64,
}));

describe('InlineVideoFrames', () => {
  it('does not hide earlier references in a hover-only stack on mobile', () => {
    render(
      <InlineVideoFrames
        imageUrl="/one.png"
        imageUrls={['/two.png']}
        isSupportEndImage={false}
        maxCount={2}
        onEndImageChange={vi.fn()}
        onImageChange={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId('reference')[1]).toHaveStyle({ marginInlineStart: '4px' });
  });
});
