'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { ChevronLeft } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

const Header = memo(() => {
  const { t } = useTranslation('common');

  const navigate = useNavigate();
  return (
    <ChatHeader
      style={mobileHeaderSticky}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={4}>
              {t('userPanel.profile')}
            </Flexbox>
          }
        />
      }
      left={
        <ActionIcon
          aria-label={t('back')}
          icon={ChevronLeft}
          size={MOBILE_HEADER_ICON_SIZE}
          title={t('back')}
          onClick={() => navigate('/me')}
        />
      }
    />
  );
});

export default Header;
