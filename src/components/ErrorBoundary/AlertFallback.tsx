'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { lazy, memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

const Highlighter = lazy(() => import('@lobehub/ui/es/Highlighter/index'));

interface AlertFallbackProps {
  error: Error;
  resetErrorBoundary: (...args: unknown[]) => void;
  title?: string;
}

const AlertFallback = memo<AlertFallbackProps>(({ error, resetErrorBoundary, title }) => {
  const { t } = useTranslation('common');
  return (
    <Alert
      closable
      showIcon
      extraIsolate={false}
      message={t('errorBoundary.message')}
      style={{ overflow: 'hidden', position: 'relative', width: '100%' }}
      text={{ detail: t('errorBoundary.details') }}
      title={title || t('errorBoundary.render')}
      type="secondary"
      extra={
        error?.message || error?.stack ? (
          <Suspense fallback={null}>
            <Highlighter
              actionIconSize="small"
              language="plaintext"
              padding={8}
              variant="borderless"
            >
              {error.stack || error.message}
            </Highlighter>
          </Suspense>
        ) : undefined
      }
      onClose={resetErrorBoundary}
    />
  );
});

AlertFallback.displayName = 'AlertFallback';

export default AlertFallback;
