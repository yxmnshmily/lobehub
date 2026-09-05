import { describe, expect, it } from 'vitest';

import { createAuthI18n } from './createAuthI18n';

describe('createAuthI18n', () => {
  it('loads the selected auth locale instead of keeping the English fallback', async () => {
    const authI18n = createAuthI18n('en-US');
    await authI18n.init();

    await authI18n.instance.changeLanguage('ja-JP');
    await authI18n.instance.loadNamespaces('auth');

    const appName = authI18n.instance.t('signin.appName', { ns: 'auth' });

    expect(appName).toBe('旅行コミュニティネットワーク');
    expect(
      authI18n.instance.t('signin.subtitle', {
        appName,
        ns: 'auth',
      }),
    ).toBe('旅行コミュニティネットワークアカウントに登録またはログインする');
    expect(authI18n.instance.t('betterAuth.phone.sendCode', { ns: 'auth' })).toBe('コードを送信');
  });
});
