import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuickActions } from './QuickActions';

vi.mock('./useFileItemDropdown', () => ({ useFileItemDropdown: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('resource quick actions', () => {
  it('copies content, downloads and confirms deletion without opening the material', () => {
    const copy = vi.fn();
    const download = vi.fn();
    const remove = vi.fn();
    const open = vi.fn();
    render(
      <div onClick={open}>
        <QuickActions
          menuItems={[
            { key: 'copyContent', onClick: copy },
            { key: 'download', onClick: download },
            { key: 'delete', onClick: remove },
          ]}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'download' }));
    fireEvent.click(screen.getByRole('button', { name: 'delete' }));
    expect(copy).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
  it('does not create a delete action when permission omits it', () => {
    render(<QuickActions menuItems={[{ key: 'download', onClick: vi.fn() }]} />);
    expect(screen.queryByRole('button', { name: 'delete' })).not.toBeInTheDocument();
  });
});
