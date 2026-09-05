import type { LobeChatDatabase } from '@lobechat/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initTravelServiceAccount } from './travelServiceAccount';

const { getAccount, TravelServiceLedgerModel } = vi.hoisted(() => ({
  getAccount: vi.fn(),
  TravelServiceLedgerModel: vi.fn(),
}));

vi.mock('@lobechat/database', () => ({
  TravelServiceLedgerModel: TravelServiceLedgerModel.mockImplementation(() => ({ getAccount })),
}));

describe('initTravelServiceAccount', () => {
  beforeEach(() => {
    getAccount.mockReset();
    TravelServiceLedgerModel.mockClear();
    getAccount.mockResolvedValue({ balanceFen: 0, currency: 'CNY', userId: 'new-user' });
  });

  it('idempotently ensures a zero-CNY account for the new user', async () => {
    const db = {} as LobeChatDatabase;

    await expect(initTravelServiceAccount(db, 'new-user')).resolves.toMatchObject({
      balanceFen: 0,
      currency: 'CNY',
      userId: 'new-user',
    });
    expect(TravelServiceLedgerModel).toHaveBeenCalledWith(db, 'new-user');
    expect(getAccount).toHaveBeenCalledOnce();
  });
});
