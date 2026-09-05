'use client';

import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { AUTH_PRIVACY_URL, AUTH_TERMS_URL } from './policyLinks';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    color: inherit;

    &:visited {
      color: ${cssVar.colorLinkActive};
    }

    @media (pointer: coarse) {
      min-height: 44px;
    }
  `,
}));

const AuthFooterLinks = memo(() => {
  const { t } = useTranslation('auth');
  return (
    <Text align={'center'} fontSize={13} type={'secondary'}>
      <a className={styles.link} href={AUTH_TERMS_URL} rel="noopener noreferrer" target="_blank">
        {t('footer.terms')}
      </a>
      <span style={{ marginInline: 8 }}>·</span>
      <a className={styles.link} href={AUTH_PRIVACY_URL} rel="noopener noreferrer" target="_blank">
        {t('footer.privacy')}
      </a>
    </Text>
  );
});

export default AuthFooterLinks;
