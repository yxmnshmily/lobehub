import { Flexbox, Input } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { useRef, useState } from 'react';

import { useFileStore } from '@/store/file';
import { useTravelTranslation } from '@/utils/i18n/travel';

export default function AvatarUrlField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const translateTravel = useTravelTranslation();
  const upload = useFileStore((s) => s.uploadWithProgress);
  const picker = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const uploadAvatar = async (file?: File) => {
    if (!file || inFlight.current) return;
    setError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError(translateTravel('仅支持 5 MB 以内的 JPG、PNG、WebP 图片'));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await upload({ file });
      if (!result?.url) throw new Error('Missing image URL');
      const url = new URL(result.url, window.location.origin);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid image URL');
      onChange(url.href);
    } catch {
      setError(translateTravel('头像上传失败，请重试；原地址未修改'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align="center" gap={8}>
        <Input
          aria-label={translateTravel('用户头像 URL')}
          disabled={busy}
          maxLength={2048}
          placeholder={translateTravel('https://... （留空可清除）')}
          style={{ flex: 1, minWidth: 0 }}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <Button loading={busy} style={{ flexShrink: 0 }} onClick={() => picker.current?.click()}>
          {translateTravel('点击上传')}
        </Button>
        <input
          hidden
          accept="image/jpeg,image/png,image/webp"
          aria-label={translateTravel('选择头像图片')}
          disabled={busy}
          ref={picker}
          type="file"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void uploadAvatar(file);
          }}
        />
      </Flexbox>
      {error && <span role="alert">{error}</span>}
    </Flexbox>
  );
}
