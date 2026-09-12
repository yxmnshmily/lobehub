import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RuntimeModelContext } from '../../RuntimeModelContext';
import ScopedModelSwitch from './index';

describe('group model selector', () => {
  it('renders the configured group model without crashing the conversation', () => {
    render(
      <RuntimeModelContext value={{ model: 'group-model', provider: 'provider', status: 'ready' }}>
        <ScopedModelSwitch />
      </RuntimeModelContext>,
    );
    expect(screen.getByText('group-model')).toBeVisible();
  });

  it('lets a failed group model request be retried', () => {
    const retry = vi.fn();
    render(
      <RuntimeModelContext value={{ model: '', provider: '', status: 'error', retry }}>
        <ScopedModelSwitch />
      </RuntimeModelContext>,
    );
    fireEvent.click(screen.getByRole('button', { name: '群模型加载失败，点击重试' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
