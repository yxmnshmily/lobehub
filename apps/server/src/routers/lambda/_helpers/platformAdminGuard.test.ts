import { describe, expect, it, vi } from 'vitest';

import { assertPlatformAdmin } from './platformAdminGuard';

describe('assertPlatformAdmin', () => {
  it('rejects an ordinary authenticated customer', async () => {
    const hasGlobalRole = vi.fn().mockResolvedValue(false);

    await expect(assertPlatformAdmin({ hasGlobalRole } as any)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('allows a globally assigned super_admin', async () => {
    const hasGlobalRole = vi.fn().mockResolvedValue(true);

    await expect(assertPlatformAdmin({ hasGlobalRole } as any)).resolves.toBeUndefined();
    expect(hasGlobalRole).toHaveBeenCalledWith('super_admin');
  });
});
