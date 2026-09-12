import type { NotificationSettings } from '@lobechat/types';

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  sms: { enabled: false },
  email: {
    enabled: false,
    items: {
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
    },
  },
  inbox: {
    enabled: true,
    items: {
      generation: {
        image_generation_completed: true,
        video_generation_completed: true,
      },
    },
  },
};
