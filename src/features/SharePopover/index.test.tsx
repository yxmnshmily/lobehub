/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SharePopover from '.';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

describe('controlled topic sharing', () => {
  it('keeps the trigger working before a scroll-selected topic has mounted', () => {
    const onOpenChange = vi.fn();
    render(
      <SharePopover open={false} onOpenChange={onOpenChange}>
        <button>Share visible topic</button>
      </SharePopover>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Share visible topic' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
