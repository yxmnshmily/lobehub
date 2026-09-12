import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';

import useBusinessMenuItems from './useBusinessMenuItems';

const MenuItems = ({ signedIn }: { signedIn: boolean }) => (
  <>
    {useBusinessMenuItems(signedIn).map((item) => (
      <div key={item.key}>{item.label}</div>
    ))}
  </>
);

it('links signed-in users to local plans and hides the entry when signed out', () => {
  const view = render(
    <MemoryRouter>
      <MenuItems signedIn />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link')).toHaveAttribute('href', '/settings/plans');
  view.rerender(
    <MemoryRouter>
      <MenuItems signedIn={false} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
