import { SendButton as Send } from '@lobehub/editor/react';
import { Flexbox, Tooltip } from '@lobehub/ui';
import { ActionIcon, DropdownMenu } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { useChatInputResourceAccess } from '../hooks/useChatInputResourceAccess';
import { selectors, useChatInputStore } from '../store';

const SendButton = memo(() => {
  const { t } = useTranslation('setting');
  const sendMenu = useChatInputStore((s) => s.sendMenu);
  const mobile = useChatInputStore((s) => s.mobile);
  const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
  const size = useChatInputStore((s) => s.sendButtonProps?.size);
  const { generating, disabled } = useChatInputStore(selectors.sendButtonProps, isEqual);
  const [send, handleStop] = useChatInputStore((s) => [s.handleSendButton, s.handleStop]);

  // Workspace viewer doesn't have `message:create` → backend would 403.
  // OR the permission gate into the existing disabled prop so the button
  // visibly grays out and a tooltip explains why.
  const { allowed: canCreate, reason } = usePermission('create_content');

  // Per-resource General-access gating: a member with view-only access on the
  // bound agent/group can read the conversation but the server rejects sends.
  const { canUseResource } = useChatInputResourceAccess();
  const viewOnly = !canUseResource;
  const canSend = canCreate && !viewOnly;
  const sendLabel = t('send', { ns: 'common' });
  const sendOptionsLabel = t('more', { ns: 'common' });
  const isDisabled = disabled || !canSend;
  const controlSize = size ?? (mobile ? 44 : 32);

  const button = (
    <Flexbox horizontal align={'center'} gap={0}>
      <Send
        aria-label={generating ? t('stop', { ns: 'common' }) : sendLabel}
        disabled={isDisabled}
        generating={generating}
        shape={shape}
        size={controlSize}
        style={{ minWidth: shape === 'round' ? controlSize : controlSize + 16 }}
        title={generating ? t('stop', { ns: 'common' }) : sendLabel}
        onClick={generating || !canSend ? undefined : () => send()}
        onStop={() => handleStop()}
      />
      {!generating && canSend && sendMenu && (
        <DropdownMenu
          nativeButton
          items={sendMenu.items}
          placement={'topRight'}
          triggerProps={{ disabled: isDisabled }}
        >
          <ActionIcon
            aria-label={sendOptionsLabel}
            disabled={isDisabled}
            icon={ChevronDownIcon}
            size={{ blockSize: controlSize, size: 16 }}
            title={sendOptionsLabel}
          />
        </DropdownMenu>
      )}
    </Flexbox>
  );

  if (!canCreate) return <Tooltip title={reason}>{button}</Tooltip>;
  if (viewOnly) return <Tooltip title={t('permission.viewOnlySendTip')}>{button}</Tooltip>;
  return button;
});

SendButton.displayName = 'SendButton';

export default SendButton;
