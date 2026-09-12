import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';

import { useTravelTranslation } from '@/utils/i18n/travel';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 28px;
    font-weight: 700;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

const PersonaHeader = () => {
  const translateTravel = useTravelTranslation();
  return (
    <Text as={'h1'} className={styles.title}>
      {translateTravel('个人画像')}
    </Text>
  );
};

export default PersonaHeader;
