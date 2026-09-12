'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkeletonText from '@/components/Skeleton/Text';
import { DESKTOP_HOTKEYS_REGISTRATION } from '@/const/desktopGlobalShortcuts';
import { FORM_STYLE } from '@/const/layoutTokens';
import { SettingsSearchAnchor } from '@/features/SettingsSearch/anchor';
import { useElectronStore } from '@/store/electron';
import { desktopHotkeysSelectors } from '@/store/electron/selectors';
import { type DesktopHotkeyItem } from '@/types/hotkey';

import AccessibleHotkeyInput from './AccessibleHotkeyInput';
import { hotkeyFormStyles } from './styles';

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey', 'common']);
  const [form] = Form.useForm();

  const hotkeys = useElectronStore(desktopHotkeysSelectors.hotkeys, isEqual);

  const [isHotkeysInit, updateDesktopHotkey, useFetchDesktopHotkeys] = useElectronStore((s) => [
    desktopHotkeysSelectors.isHotkeysInit(s),
    s.updateDesktopHotkey,
    s.useFetchDesktopHotkeys,
  ]);

  useFetchDesktopHotkeys();

  const [loading, setLoading] = useState(false);

  if (!isHotkeysInit) return <SkeletonText rows={5} />;

  const updateHotkey = async (id: DesktopHotkeyItem['id'], value: string) => {
    setLoading(true);
    try {
      const result = await updateDesktopHotkey(id, value);
      if (result.success) {
        toast.success(t('hotkey.updateSuccess', { ns: 'setting' }));
      } else {
        // Show the appropriate error message based on error type
        toast.error(t(`hotkey.errors.${result.errorType}` as any, { ns: 'setting' }));
      }
    } catch {
      toast.error(t('hotkey.updateError', { ns: 'setting' }));
    } finally {
      setLoading(false);
    }
  };

  const mapHotkeyItem = (item: DesktopHotkeyItem) => ({
    children: (
      <AccessibleHotkeyInput
        allowClear={!item.nonEditable}
        clearLabel={t('hotkey.clearBinding')}
        disabled={item.nonEditable}
        placeholder={t('hotkey.record')}
        resetLabel={t('reset', { ns: 'common' })}
        resetValue={item.keys}
        value={hotkeys[item.id]}
        onChange={(value) => void updateHotkey(item.id, value)}
      />
    ),

    label: t(`desktop.${item.id}.title`, { ns: 'hotkey' }),
    name: item.id,
  });

  const desktop: FormGroupItemType = {
    children: DESKTOP_HOTKEYS_REGISTRATION.map((item) => mapHotkeyItem(item)),
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: (
      <SettingsSearchAnchor id={'hotkey-desktop'}>{t('hotkey.group.desktop')}</SettingsSearchAnchor>
    ),
  };

  return (
    <Form
      classNames={{ item: hotkeyFormStyles.item }}
      collapsible={false}
      form={form}
      initialValues={hotkeys}
      items={[desktop]}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default HotkeySetting;
