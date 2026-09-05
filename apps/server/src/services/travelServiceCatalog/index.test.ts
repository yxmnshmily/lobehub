import { describe, expect, it } from 'vitest';

import { getTravelServiceOffer } from './index';

describe('getTravelServiceOffer', () => {
  it.each(['image', 'video'] as const)(
    'fails closed when the %s service price is not configured',
    (type) => {
      expect(getTravelServiceOffer(type, {})).toEqual({
        available: false,
        title: type === 'image' ? '旅游图片制作' : '旅游视频制作',
        type,
      });
    },
  );

  it('uses a positive integer price in fen owned by server configuration', () => {
    expect(getTravelServiceOffer('image', { TRAVEL_IMAGE_SERVICE_PRICE_FEN: '1280' })).toEqual({
      amountFen: 1280,
      available: true,
      title: '旅游图片制作',
      type: 'image',
    });
    expect(getTravelServiceOffer('video', { TRAVEL_VIDEO_SERVICE_PRICE_FEN: '6800' })).toEqual({
      amountFen: 6800,
      available: true,
      title: '旅游视频制作',
      type: 'video',
    });
  });

  it.each(['', '0', '-1', '1.5', '12元', '2000000001'])(
    'rejects an invalid image price %j',
    (price) => {
      expect(
        getTravelServiceOffer('image', { TRAVEL_IMAGE_SERVICE_PRICE_FEN: price }),
      ).toMatchObject({ available: false, type: 'image' });
    },
  );

  it('does not let an unrelated environment key enable another service', () => {
    const env = { TRAVEL_IMAGE_SERVICE_PRICE_FEN: '1280' };
    expect(getTravelServiceOffer('video', env)).toMatchObject({
      available: false,
      type: 'video',
    });
  });
});
