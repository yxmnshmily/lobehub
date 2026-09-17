import { describe, expect, it, vi } from 'vitest';

import type { PageStore } from '../../store';
import { CrudActionImpl } from './action';

vi.mock('@/libs/swr', () => ({ useClientDataSWRWithSync: vi.fn() }));
vi.mock('@/services/document', () => ({ documentService: {} }));

describe('createNewPage navigation', () => {
  it.each([undefined, 'private', 'public'] as const)(
    'opens an unsaved draft in the %s bucket without adding a list item',
    async (visibility) => {
      const navigate = vi.fn();
      const createPage = vi.fn();
      const createOptimisticPage = vi.fn();
      const state = { navigate, createPage, createOptimisticPage } as unknown as PageStore;
      const set = vi.fn();
      const actions = new CrudActionImpl(set, () => state);
      const target = `new${visibility ? `?visibility=${visibility}` : ''}`;
      expect(await actions.createNewPage('无标题', visibility)).toBe(target);
      expect(await actions.createNewPage('无标题', visibility)).toBe(target);
      expect(navigate).toHaveBeenCalledWith(`/page/${target}`);
      expect(createPage).not.toHaveBeenCalled();
      expect(createOptimisticPage).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    },
  );
});
