import { ActionIcon, Button } from '@lobehub/ui/base-ui';
import { ChatHeader as MobileChatHeader } from '@lobehub/ui/mobile';
import { cssVar } from 'antd-style';
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';

import GroupBrandTitle from './GroupBrandTitle';
import { useMobileGroupSidebar } from './useMobileGroupSidebar';

export default function ConversationHeader({
  mobile,
  onBack,
  right,
  title,
}: {
  mobile?: boolean;
  onBack?: () => void;
  right: ReactNode;
  title: string;
}) {
  const sidebar = useMobileGroupSidebar();
  const { t } = useTranslation('common');
  if (mobile)
    return (
      <MobileChatHeader
        right={right}
        style={{ width: '100%' }}
        center={
          <MobileChatHeader.Title
            title={
              <span
                style={{
                  display: 'block',
                  fontSize: 'clamp(14px, 4vw, 16px)',
                  lineHeight: '20px',
                  maxWidth: '46vw',
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <GroupBrandTitle title={title} />
              </span>
            }
          />
        }
        left={
          sidebar ? (
            <ActionIcon
              aria-expanded={sidebar.open}
              aria-label={sidebar.open ? '收起侧栏' : '展开侧栏'}
              icon={sidebar.open ? PanelLeftClose : PanelLeftOpen}
              style={{ width: 44, height: 44 }}
              title={sidebar.open ? '收起侧栏' : '展开侧栏'}
              tooltipProps={{ placement: 'bottom' }}
              onClick={sidebar.toggle}
            />
          ) : (
            onBack && (
              <Button icon={ChevronLeft} size="small" type="text" onClick={onBack}>
                {t('backToHome')}
              </Button>
            )
          )
        }
      />
    );
  return (
    <NavHeader
      height={56}
      paddingInline={16}
      right={right}
      styles={{ center: { minWidth: 0 }, right: { flexShrink: 0 } }}
      style={{
        background: cssVar.colorBgContainer,
        borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}`,
      }}
    >
      <h1
        title={title}
        style={{
          color: cssVar.colorText,
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1.5,
          margin: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        <GroupBrandTitle title={title} />
      </h1>
    </NavHeader>
  );
}
