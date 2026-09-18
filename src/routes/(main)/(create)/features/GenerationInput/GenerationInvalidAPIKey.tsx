'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { ModelProvider } from 'model-bank/modelProvider';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { ProviderIcon } from '@/components/LobeIcons';
import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProviderName } from '@/hooks/useProviderName';
import { type GlobalLLMProviderKey } from '@/types/user/settings/modelProvider';

interface GenerationInvalidAPIKeyProps {
  onNavigate?: () => void;
  provider?: string;
}

const GenerationInvalidAPIKey = memo<GenerationInvalidAPIKeyProps>(({ provider, onNavigate }) => {
  const { t } = useTranslation(['modelProvider', 'error']);
  const navigate = useWorkspaceAwareNavigate();
  const providerName = useProviderName(provider as GlobalLLMProviderKey);

  return (
    /* 错误卡与批次栏左右各留 8px 边距（2026-09-18 用户要求）。
       只在生成页生效——BaseErrorForm 是聊天错误等页面共用的，不能直接改它。 */
    <Flexbox paddingInline={8} width={'100%'}>
      <BaseErrorForm
        avatar={<ProviderIcon provider={provider} shape={'square'} size={40} />}
        title={t(`unlock.apiKey.title`, { name: providerName, ns: 'error' })}
        action={
          <Button
            type={'primary'}
            onClick={() => {
              navigate(urlJoin('/settings/provider', provider || 'all'));
              onNavigate?.();
            }}
          >
            {t('unlock.goToSettings', { ns: 'error' })}
          </Button>
        }
        desc={
          provider === ModelProvider.Bedrock
            ? t('bedrock.unlock.description')
            : t(`unlock.apiKey.description`, {
                name: providerName,
                ns: 'error',
              })
        }
      />
    </Flexbox>
  );
});

GenerationInvalidAPIKey.displayName = 'GenerationInvalidAPIKey';

export default GenerationInvalidAPIKey;
