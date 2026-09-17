/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { expect, it } from 'vitest';

import { useGroupWorkHistory } from './useGroupWorkHistory';

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    MemoryRouter,
    {
      initialEntries: ['/group/g1/tasks?collection=tasks'],
    },
    children,
  );

it('opens a group home first and keeps history in browser navigation', () => {
  const { result } = renderHook(
    () => ({
      ...useGroupWorkHistory('g1'),
      location: useLocation(),
      navigate: useNavigate(),
    }),
    { wrapper },
  );
  expect(result.current.isHome).toBe(true);
  act(() => result.current.toggleView());
  expect(result.current.isHome).toBe(false);
  expect(result.current.location.search).toContain('view=history');
  expect(result.current.location.search).toContain('collection=tasks');
  act(() => result.current.navigate(-1));
  expect(result.current.isHome).toBe(true);
});

it('returns to home when opening another group or clicking its sidebar entry again', () => {
  const { result } = renderHook(() => ({ ...useGroupWorkHistory('g1'), navigate: useNavigate() }), {
    wrapper,
  });
  act(() => result.current.toggleView());
  act(() => result.current.navigate('/group/g2/tasks'));
  expect(result.current.isHome).toBe(true);
});

it('does not replace the existing agent and project list pages', () => {
  const { result } = renderHook(() => useGroupWorkHistory(), { wrapper });
  expect(result.current.isHome).toBe(false);
});
