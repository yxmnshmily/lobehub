/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import TablePagination from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => {
      if (key === 'table.pagination.range') {
        return `${values?.from}-${values?.to} / ${values?.total}`;
      }
      if (key === 'table.pagination.perPage') return `${values?.size} / page`;
      return key;
    },
  }),
}));

vi.mock('./PageSizeSelect', () => ({
  default: ({ ariaLabel, value }: { ariaLabel?: string; value?: number }) => (
    <span aria-label={ariaLabel}>{value} / page</span>
  ),
}));

it('keeps the summary and controls readable when the mobile footer is narrower than its content', () => {
  render(<TablePagination current={1} pageSize={10} total={110} onChange={vi.fn()} />);

  const summary = screen.getByText('1-10 / 110');
  const root = summary.parentElement!;
  const controls = summary.nextElementSibling!;
  const stylesheet = [...document.querySelectorAll('style')]
    .map((node) => node.textContent)
    .join('\n')
    .replaceAll(/\s/g, '');
  const elementHasRule = (element: Element, declaration: string) =>
    element.className
      .split(' ')
      .some((className) =>
        new RegExp(
          `\\.${className}\\{[^}]*${declaration.replaceAll(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`,
        ).test(stylesheet),
      );

  expect(elementHasRule(summary, 'white-space:nowrap')).toBe(true);
  expect(elementHasRule(root, 'overflow-x:auto')).toBe(true);
  expect(elementHasRule(root, 'scrollbar-width:none')).toBe(true);
  expect(stylesheet).toContain('::-webkit-scrollbar{display:none;}');
  expect(elementHasRule(controls, 'min-width:max-content')).toBe(true);
  expect(screen.getByLabelText('10 / page')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  expect(stylesheet).toContain('min-inline-size:36px');
  expect(stylesheet).toContain('min-block-size:36px');
});
