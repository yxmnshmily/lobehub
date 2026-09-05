/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TravelGroupReadiness from './TravelGroupReadiness';

describe('TravelGroupReadiness', () => {
  it('uses the explicit preparing copy without exposing internal diagnostics', () => {
    render(<TravelGroupReadiness status="preparing" onRetry={vi.fn()} />);

    expect(screen.getByText('正在准备您的专属旅游群')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers one clear retry action for recoverable failures', () => {
    const retry = vi.fn();
    render(<TravelGroupReadiness status="retryable_error" onRetry={retry} />);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not offer destructive repair when administrator review is required', () => {
    render(<TravelGroupReadiness status="review_required" onRetry={vi.fn()} />);

    expect(screen.getByText('专属旅游群需要管理员检查')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
