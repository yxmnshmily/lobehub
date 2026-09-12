import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createDateRangeModal } from './DateRangeModal';

const modal = vi.hoisted(() => ({ content: null as ReactNode }));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  createModal: (options: { content: ReactNode }) => {
    modal.content = options.content;
    return { close: vi.fn() };
  },
  useModalContext: () => ({ close: vi.fn() }),
}));
vi.mock('./useTask', () => ({ useMemoryAnalysisAsyncTask: () => ({ refresh: vi.fn() }) }));
vi.mock('@/services/userMemory/extraction', () => ({ memoryExtractionService: {} }));

describe('memory analysis date picker', () => {
  it('keeps the calendar in the dialog layer instead of behind its backdrop', async () => {
    createDateRangeModal();
    render(<div role="dialog">{modal.content}</div>);
    fireEvent.click(screen.getAllByRole('textbox')[0]);
    await waitFor(() => {
      const calendar = document.querySelector('.ant-picker-dropdown');
      expect(calendar).not.toBeNull();
      expect(screen.getByRole('dialog')).toContainElement(calendar as HTMLElement);
    });
  });
});
