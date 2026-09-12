'use client';

import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import {
  AtSign,
  CircleUserRound,
  Heart,
  IdCard,
  Image,
  Link,
  LockKeyhole,
  type LucideIcon,
  Mail,
  Smartphone,
} from 'lucide-react';
import { type ReactNode } from 'react';

import { SETTINGS_ANCHOR_ROW_ATTR, SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';

interface ProfileRowProps {
  action?: ReactNode;
  /** Settings-search anchor id; when set, the row becomes a scroll/highlight target */
  anchor?: string;
  children?: ReactNode;
  label?: string;
  labelSlot?: ReactNode;
}

const fieldIcons: Record<string, LucideIcon> = {
  'profile-avatar': Image,
  'profile-full-name': CircleUserRound,
  'profile-user-id': IdCard,
  'profile-username': AtSign,
  'profile-password': LockKeyhole,
  'profile-email': Mail,
  'profile-phone': Smartphone,
  'profile-connected-accounts': Link,
  'profile-interests': Heart,
};

const styles = createStaticStyles(({ css, responsive }) => ({
  action: css`
    flex-shrink: 0;

    /* Keep action trailing even for action-only rows (AvatarRow / PasswordRow) where body has no children and space-between degenerates to flex-start. */
    margin-inline-start: auto;
  `,
  body: css`
    display: flex;
    flex: 1;
    gap: 12px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
  `,
  label: css`
    flex: 0 0 160px;

    ${responsive.md} {
      flex: 0 0 auto;
    }
  `,
  labelContent: css`
    display: inline-flex;
    gap: 8px;
    align-items: center;

    > svg {
      flex-shrink: 0;
    }
  `,
  row: css`
    display: flex;
    gap: 24px;
    align-items: center;

    min-height: 48px;
    padding-block: 16px;

    ${responsive.md} {
      flex-direction: column;
      gap: 12px;
      align-items: stretch;
    }
  `,
}));

const ProfileRow = ({ anchor, label, labelSlot, children, action }: ProfileRowProps) => {
  const FieldIcon = anchor ? fieldIcons[anchor] : undefined;
  const labelNode = (
    <span className={styles.labelContent}>
      {FieldIcon && <FieldIcon aria-hidden size={18} />}
      {labelSlot ?? (label && <Text strong>{label}</Text>)}
    </span>
  );

  return (
    <div className={styles.row} {...(anchor ? { [SETTINGS_ANCHOR_ROW_ATTR]: '' } : undefined)}>
      <div className={styles.label}>
        {anchor ? <SettingsSearchAnchor id={anchor}>{labelNode}</SettingsSearchAnchor> : labelNode}
      </div>
      <div className={styles.body}>
        {children}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
};

export default ProfileRow;
