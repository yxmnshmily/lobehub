'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { createStaticStyles } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MOBILE_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

import StoreSearchBar from '../../../../(main)/community/features/Search';
import Nav from './Nav';

const styles = createStaticStyles(({ css, cssVar }) => ({
  search: css`
    position: absolute;
    z-index: 10;
    inset-block-start: 0;
    inset-inline: 0;

    background: ${cssVar.colorBgLayout};
  `,
}));

const Header = memo(() => {
  const [showSearch, setShowSearch] = useState(false);
  const { t } = useTranslation('discover');

  return (
    <ChatHeader
      left={<Nav />}
      styles={{ center: { display: 'none' } }}
      right={
        showSearch ? (
          <Flexbox align={'center'} className={styles.search} paddingBlock={8} paddingInline={16}>
            <StoreSearchBar mobile onBlur={() => setShowSearch(false)} />
          </Flexbox>
        ) : (
          <ActionIcon
            aria-label={t('search.placeholder')}
            icon={SearchIcon}
            size={MOBILE_HEADER_ICON_SIZE}
            onClick={() => setShowSearch(true)}
          />
        )
      }
      style={{
        ...mobileHeaderSticky,
        overflow: 'unset',
      }}
    />
  );
});

export default Header;
