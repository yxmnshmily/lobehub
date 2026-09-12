'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Brain, UserRound } from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import SideBarHeaderLayout from '@/features/NavPanel/SideBarHeaderLayout';

import Nav from './Nav';

const Header = memo<PropsWithChildren>(() => {
  const { t } = useTranslation(['common', 'auth']);
  return (
    <>
      <SideBarHeaderLayout
        breadcrumb={[
          {
            href: '/memory',
            title: (
              <Flexbox
                horizontal
                align="center"
                gap={6}
                style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
              >
                <Icon icon={Brain} />
                <span>{t('tab.memory')}</span>
              </Flexbox>
            ),
          },
        ]}
        homeItem={{
          href: '/settings/profile',
          title: (
            <Flexbox
              horizontal
              align="center"
              gap={6}
              style={{ color: 'inherit', fontSize: 14, whiteSpace: 'nowrap' }}
            >
              <Icon icon={UserRound} />
              <span>{t('profile.title', { ns: 'auth' })}</span>
            </Flexbox>
          ),
        }}
      />
      <Nav />
    </>
  );
});

export default Header;
