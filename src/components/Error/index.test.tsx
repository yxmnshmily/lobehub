import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import ErrorCapture from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const LocationProbe = () => <output>{useLocation().pathname}</output>;

describe('ErrorCapture', () => {
  it('uses router navigation so back home stays inside the mounted app', () => {
    const router = createMemoryRouter(
      [
        { element: <LocationProbe />, path: '/' },
        {
          element: (
            <>
              <ErrorCapture error={new Error('broken')} resetPath="/" />
              <LocationProbe />
            </>
          ),
          path: '/agents',
        },
      ],
      { initialEntries: ['/agents'] },
    );
    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole('button', { name: 'error.backHome' }));
    expect(screen.getByText('/', { selector: 'output' })).toBeInTheDocument();
  });
});
