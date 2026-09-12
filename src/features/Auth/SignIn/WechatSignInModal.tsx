import { createStaticStyles } from 'antd-style';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    aspect-ratio: 3 / 4;
    width: min(472.5px, 75vw, 56.25dvh);
  `,
}));

interface WechatSignInModalProps {
  authUrl: string | null;
  callbackUrl: string;
  onClose: () => void;
}

export const WechatSignInModal = ({ authUrl, callbackUrl, onClose }: WechatSignInModalProps) => {
  const { t } = useTranslation(['auth', 'common']);
  const wechatLabel = t('betterAuth.signin.continueWithWechat', { ns: 'auth' });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (authUrl === null) return null;

  return (
    <div
      aria-label={wechatLabel}
      aria-modal="true"
      role="dialog"
      style={{
        alignItems: 'center',
        background: 'rgb(0 0 0 / 45%)',
        display: 'flex',
        inset: 0,
        justifyContent: 'center',
        padding: 'clamp(12px, 4vw, 32px)',
        position: 'fixed',
        zIndex: 2000,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.panel}
        style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 80px rgb(0 0 0 / 24%)',
          color: '#080808',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            alignItems: 'center',
            borderBottom: '0.5px solid #eef0f3',
            display: 'flex',
            justifyContent: 'space-between',
            minHeight: 56,
            padding: '0 12px 0 20px',
          }}
        >
          <strong>{wechatLabel}</strong>
          <button
            aria-label={t('close', { ns: 'common' })}
            type="button"
            style={{
              background: 'transparent',
              border: 0,
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: 26,
              height: 44,
              lineHeight: 1,
              width: 44,
            }}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {authUrl ? (
          <iframe
            allow="clipboard-write"
            aria-label={wechatLabel}
            src={authUrl}
            style={{ border: 0, height: '100%', width: '100%' }}
            title={wechatLabel}
            onLoad={(event) => {
              try {
                const frameLocation = event.currentTarget.contentWindow?.location;
                if (frameLocation?.origin === window.location.origin && frameLocation.pathname) {
                  window.location.href = callbackUrl;
                }
              } catch {
                // The WeChat authorization page is cross-origin until login completes.
              }
            }}
          />
        ) : (
          <div style={{ alignSelf: 'center', color: 'GrayText', justifySelf: 'center' }}>
            {t('loading', { ns: 'common' })}
          </div>
        )}
      </section>
    </div>
  );
};
