import { TokenTag } from '@lobehub/ui/chat';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ActionPopover from '../components/ActionPopover';
import TokenDetails from './TokenDetails';
import { useTokenBreakdown } from './useTokenBreakdown';

const Token = memo(() => {
  const { t } = useTranslation('chat');

  const { chatsToken, historySummaryToken, maxTokens, systemRoleToken, toolsToken, totalToken } =
    useTokenBreakdown();
  const content = useMemo(
    () => (
      <TokenDetails
        breakdown={{
          chatsToken,
          historySummaryToken,
          maxTokens,
          systemRoleToken,
          toolsToken,
          totalToken,
        }}
      />
    ),
    [chatsToken, historySummaryToken, maxTokens, systemRoleToken, toolsToken, totalToken],
  );

  return (
    <ActionPopover content={content}>
      <TokenTag
        maxValue={maxTokens}
        mode={'used'}
        value={totalToken}
        size={{
          blockSize: 28,
          size: 18,
        }}
        text={{
          overload: t('tokenTag.overload'),
          remained: t('tokenTag.remained'),
          used: t('tokenTag.used'),
        }}
      />
    </ActionPopover>
  );
});

Token.displayName = 'ContextWindowToken';

export default Token;
