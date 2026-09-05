import { ActionIcon } from '@lobehub/ui/base-ui';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '@/features/ChatInput/store';
import { usePermission } from '@/hooks/usePermission';

const ExpandButton = memo(() => {
  const { t } = useTranslation('editor');
  const [expand, setExpand, editor, mobile] = useChatInputStore((s) => [
    s.expand,
    s.setExpand,
    s.editor,
    s.mobile,
  ]);
  const { allowed: canUseChatInputAction, reason } = usePermission('create_content');
  const label = canUseChatInputAction
    ? t(expand ? 'actions.expand.off' : 'actions.expand.on')
    : reason;
  return (
    <ActionIcon
      aria-label={label}
      className="show-on-hover"
      disabled={!canUseChatInputAction}
      icon={expand ? Minimize2Icon : Maximize2Icon}
      size={{ blockSize: mobile ? 44 : 32, size: 16, strokeWidth: 2.3 }}
      title={label}
      style={{
        zIndex: 10,
      }}
      onClick={() => {
        if (!canUseChatInputAction) return;
        setExpand?.(!expand);
        editor?.focus();
      }}
    />
  );
});

ExpandButton.displayName = 'ExpandButton';

export default ExpandButton;
