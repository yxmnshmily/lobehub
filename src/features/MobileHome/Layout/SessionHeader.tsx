'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { MessageSquarePlus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ProductLogo } from '@/components/Branding';
import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import UserAvatar from '@/features/User/UserAvatar';
import { useSessionStore } from '@/store/session';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import { styles } from './SessionHeader/style';

const Header = memo(() => {
  const [createSession] = useSessionStore((s) => [s.createSession]);
  const navigate = useNavigate();
  const { t } = useTranslation(['topic', 'common']);

  return (
    <ChatHeader
      style={mobileHeaderSticky}
      left={
        <Flexbox horizontal align={'center'} className={styles.leftContainer} gap={8}>
          <button
            aria-label={t('userPanel.profile', { ns: 'common' })}
            type="button"
            style={{
              alignItems: 'center',
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              display: 'flex',
              height: 44,
              justifyContent: 'center',
              padding: 6,
              width: 44,
            }}
            onClick={() => navigate('/me')}
          >
            <UserAvatar size={32} />
          </button>
          <ProductLogo type={'text'} />
        </Flexbox>
      }
      right={
        <ActionIcon
          aria-label={t('management.actions.newChat')}
          icon={MessageSquarePlus}
          size={MOBILE_HEADER_ICON_SIZE}
          title={t('management.actions.newChat')}
          onClick={() => createSession()}
        />
      }
    />
  );
});

export default Header;
