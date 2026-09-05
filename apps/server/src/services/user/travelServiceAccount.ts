import { type LobeChatDatabase, TravelServiceLedgerModel } from '@lobechat/database';

export const initTravelServiceAccount = (db: LobeChatDatabase, userId: string) =>
  new TravelServiceLedgerModel(db, userId).getAccount();
