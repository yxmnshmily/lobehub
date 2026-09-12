import { expect, it, vi } from 'vitest';

import { notifyMaterialDeletion, subscribeMaterialDeletion } from './materialDeletion';

it('notifies all material views and allows them to unsubscribe', () => {
  const first = vi.fn();
  const second = vi.fn();
  const unsubscribe = subscribeMaterialDeletion(first);
  const cleanup = subscribeMaterialDeletion(second);
  notifyMaterialDeletion();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  unsubscribe();
  notifyMaterialDeletion();
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  cleanup();
});
