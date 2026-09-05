import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AuthIcons from './AuthIcons';

describe('AuthIcons', () => {
  it('renders the branded WeChat icon for the WeChat provider', () => {
    render(AuthIcons('wechat', 18));

    const title = screen.getByTitle('WeChat');
    expect(title.closest('svg')).toHaveAttribute('width', '18');
  });
});
