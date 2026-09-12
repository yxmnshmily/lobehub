'use client';

import { Flexbox } from '@lobehub/ui';
import { Modal } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';

import { PortalContent } from './router';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    background: linear-gradient(${cssVar.colorBgElevated}, ${cssVar.colorBgContainer}) !important;
  `,
  mobileSheet: css`
    width: 100% !important;
    max-width: 100% !important;
    height: 100dvh !important;
    max-height: 100dvh !important;
    border: 0 !important;
    border-radius: 0 !important;
  `,
}));

const MobilePortal = () => {
  const [showMobilePortal, isPortalThread, clearPortalStack] = useChatStore((state) => [
    state.showPortal,
    portalThreadSelectors.showThread(state),
    state.clearPortalStack,
  ]);
  const { t } = useTranslation('portal');

  const renderBody = (body: ReactNode) => (
    <Flexbox gap={8} height={'calc(100% - 52px)'} padding={'0 8px'} style={{ overflow: 'hidden' }}>
      <Flexbox
        height={'100%'}
        style={{ marginInline: -8, overflow: 'hidden', position: 'relative' }}
        width={'calc(100% + 16px)'}
      >
        {body}
      </Flexbox>
    </Flexbox>
  );

  return (
    // Declarative rather than `createModal`: the portal body reaches for route
    // params (`useParams` in its header), and an imperative modal renders in the
    // global ModalHost — above every route match, where those params are empty.
    <Modal
      allowFullscreen
      className={cx(styles.mobileSheet, isPortalThread && styles.container)}
      draggable={false}
      footer={null}
      height={'100dvh'}
      open={showMobilePortal}
      title={t('title')}
      width={'100vw'}
      styles={{
        body: { padding: 0, paddingBottom: 'env(safe-area-inset-bottom)' },
        header: { display: 'none' },
      }}
      onCancel={() => clearPortalStack()}
    >
      <PortalContent renderBody={renderBody} />
    </Modal>
  );
};

export default MobilePortal;
