export type TravelPaidServiceType = 'image' | 'video';

export interface TravelServiceOffer {
  amountFen?: number;
  available: boolean;
  title: string;
  type: TravelPaidServiceType;
}

type TravelServiceEnvironment = Record<string, string | undefined>;

const MAX_SERVICE_PRICE_FEN = 2_000_000_000;

const SERVICE_CONFIG: Record<
  TravelPaidServiceType,
  { envKey: 'TRAVEL_IMAGE_SERVICE_PRICE_FEN' | 'TRAVEL_VIDEO_SERVICE_PRICE_FEN'; title: string }
> = {
  image: { envKey: 'TRAVEL_IMAGE_SERVICE_PRICE_FEN', title: '旅游图片制作' },
  video: { envKey: 'TRAVEL_VIDEO_SERVICE_PRICE_FEN', title: '旅游视频制作' },
};

const configuredAmountFen = (value: string | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value)) return;
  const amountFen = Number(value);
  if (!Number.isSafeInteger(amountFen) || amountFen <= 0 || amountFen > MAX_SERVICE_PRICE_FEN) {
    return;
  }
  return amountFen;
};

/** Server-owned paid-service catalog. Missing or invalid prices always fail closed. */
export const getTravelServiceOffer = (
  type: TravelPaidServiceType,
  env: TravelServiceEnvironment = process.env,
): TravelServiceOffer => {
  const config = SERVICE_CONFIG[type];
  const amountFen = configuredAmountFen(env[config.envKey]);
  return {
    ...(amountFen === undefined ? {} : { amountFen }),
    available: amountFen !== undefined,
    title: config.title,
    type,
  };
};

export const getTravelServiceOffers = (env: TravelServiceEnvironment = process.env) => ({
  image: getTravelServiceOffer('image', env),
  video: getTravelServiceOffer('video', env),
});
