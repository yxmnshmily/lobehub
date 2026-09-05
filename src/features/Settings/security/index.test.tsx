import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import Security from '.';

vi.mock('@/business/client/BusinessSettingPages/CustomerCenterPage', () => ({
  default: ({ defaultSection }: { defaultSection: string }) => (
    <div>customer-center:{defaultSection}</div>
  ),
}));

describe('customer security settings route', () => {
  it('opens the account security section instead of redirecting away', () => {
    render(
      <MemoryRouter>
        <Security />
      </MemoryRouter>,
    );

    expect(screen.getByText('customer-center:account-security')).toBeTruthy();
  });
});
