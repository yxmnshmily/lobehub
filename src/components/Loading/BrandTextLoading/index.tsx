import { BRANDING_LOGO_URL, BRANDING_NAME } from '@lobechat/business-const';

import Image from '@/libs/next/Image';
import { useTravelTranslation } from '@/utils/i18n/travel';

import styles from './index.module.css';

interface BrandTextLoadingProps {
  debugId: string;
}

const BrandTextLoading = ({ debugId }: BrandTextLoadingProps) => {
  const translateTravel = useTravelTranslation();
  const showDebug = process.env.NODE_ENV === 'development' && debugId;

  return (
    <div className={styles.container}>
      <div aria-label={translateTravel('加载中')} className={styles.brand} role="status">
        <Image
          alt={BRANDING_NAME}
          height={64}
          loading="eager"
          src={BRANDING_LOGO_URL}
          style={{ display: 'block', objectFit: 'contain' }}
          width={64}
        />
      </div>
      {showDebug && (
        <div className={styles.debug}>
          <div className={styles.debugRow}>
            <code>{translateTravel('调试 ID：')}</code>
            <span className={styles.debugTag}>
              <code>{debugId}</code>
            </span>
          </div>
          <div className={styles.debugHint}>{translateTravel('仅在开发环境显示')}</div>
        </div>
      )}
    </div>
  );
};

export default BrandTextLoading;
