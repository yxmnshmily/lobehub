import { ActionIcon, type ActionIconProps } from '@lobehub/ui/base-ui';
import { ChevronLeftIcon } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { appNavigate } from '@/features/Electron/navigation/appNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';

export const BACK_BUTTON_ID = 'lobe-back-button';

const BackButton = memo<ActionIconProps & { to?: string }>(({ to = '/', onClick, ...rest }) => {
  const activeSlug = useActiveWorkspaceSlug();
  const { t } = useTranslation('common');
  const returnsHome = to === '/' || to === '/group/default';
  const resolvedTo = buildWorkspaceAwarePath(to, activeSlug);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event as never);
    if (event.defaultPrevented) return;
    // Let the browser handle modifier/middle clicks (open-in-new) — matches the
    // previous <Link> behavior; a plain click stays in-app via the facade.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    appNavigate(resolvedTo, { escape: true });
  };

  return (
    <a
      aria-label={returnsHome ? t('backToHome') : undefined}
      href={resolvedTo}
      title={returnsHome ? t('backToHome') : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        color: 'inherit',
        whiteSpace: 'nowrap',
      }}
      onClick={handleClick}
    >
      <ActionIcon
        icon={ChevronLeftIcon}
        id={BACK_BUTTON_ID}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        {...rest}
      />
      {returnsHome && (
        <span data-nav-label="" style={{ fontSize: 12 }}>
          {t('backToHome')}
        </span>
      )}
    </a>
  );
});

export default BackButton;
