import { BRANDING_LOGO_URL } from '@lobechat/business-const';
import type { MetaData } from '@lobechat/types';

/* 默认助手头像改用本项目 LOGO（旅游群吉祥物），与站内其他地方一致 */
export const DEFAULT_AVATAR = BRANDING_LOGO_URL || '/lobehub/app-icons/travel-cloud-mascot.png';
export const DEFAULT_USER_AVATAR = '😀';
export const DEFAULT_SUPERVISOR_AVATAR = '🎙️';
export const DEFAULT_SUPERVISOR_ID = 'supervisor';
export const DEFAULT_BACKGROUND_COLOR = undefined;
export const DEFAULT_AGENT_META: MetaData = {};
export const DEFAULT_INBOX_TITLE = '旅游群主AI';
export const DEFAULT_INBOX_AVATAR =
  BRANDING_LOGO_URL || '/lobehub/app-icons/travel-cloud-mascot.png';
export const DEFAULT_USER_AVATAR_URL = BRANDING_LOGO_URL || '/app-icons/icon-192x192.png';
