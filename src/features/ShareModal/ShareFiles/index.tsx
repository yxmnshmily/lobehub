import { exportFile } from '@lobechat/utils/client';
import { copyToClipboard, Flexbox } from '@lobehub/ui';
import { Button, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { documentService } from '@/services/document';
import { downloadFile } from '@/utils/client/downloadFile';

import { useShareData } from '../ShareDataProvider';
import { collectContent, type ContentFilter, filterContent } from './collectContent';

export default function ShareFiles({ category = 'all' }: { category?: ContentFilter }) {
  const { dbMessages, displayMessages } = useShareData();
  const { t } = useTranslation('chat');
  const [pending, setPending] = useState<string>();
  const files = filterContent(collectContent([...dbMessages, ...displayMessages]), category);

  return (
    <Flexbox gap={16} style={{ minHeight: 0, overflow: 'auto' }}>
      {files.length === 0 && <p>{t('shareModal.archive.empty')}</p>}
      {files.map((file, index) => (
        <Flexbox
          horizontal
          align="center"
          gap={12}
          key={file.messageId || file.documentId || file.url}
          style={{
            flexWrap: 'wrap',
            padding: 12,
            borderTop: index ? `0.5px dashed ${cssVar.colorBorderSecondary}` : undefined,
          }}
        >
          <span style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
            {file.name}
          </span>
          <time
            dateTime={
              file.createdAt != null && dayjs(file.createdAt).isValid()
                ? dayjs(file.createdAt).toISOString()
                : undefined
            }
            style={{
              color: cssVar.colorTextSecondary,
              fontSize: 12,
              whiteSpace: 'nowrap',
              marginLeft: 'auto',
            }}
          >
            {file.createdAt != null && dayjs(file.createdAt).isValid()
              ? dayjs(file.createdAt).format('YYYY年MM月DD日 HH:mm')
              : '—'}
          </time>
          {file.content ? (
            <>
              <Button
                onClick={async () => {
                  try {
                    await copyToClipboard(file.content!);
                  } catch {
                    toast.error(t('shareModal.fileDownloadError'));
                  }
                }}
              >
                {t('shareModal.copy')}
              </Button>
              <Button onClick={() => exportFile(file.content!, `${file.messageId}.txt`)}>
                {t('shareModal.downloadFile')}
              </Button>
              <details style={{ flexBasis: '100%', minWidth: 0 }}>
                <summary style={{ cursor: 'pointer', paddingBlock: 8 }}>
                  {t('shareModal.archive.readText')}
                </summary>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {file.content}
                </div>
              </details>
            </>
          ) : file.documentId ? (
            <Button
              loading={pending === file.documentId}
              onClick={async () => {
                setPending(file.documentId);
                try {
                  const document = await documentService.getDocumentById(file.documentId!);
                  if (!document || document.content == null)
                    throw new Error('Document unavailable');
                  exportFile(document.content, `${file.name.replaceAll(/[\\/:*?"<>|]/g, '_')}.md`);
                } catch {
                  toast.error(t('shareModal.fileDownloadError'));
                } finally {
                  setPending(undefined);
                }
              }}
            >
              {t('shareModal.exportDocument')}
            </Button>
          ) : (
            <a
              download={file.name}
              href={file.url}
              rel="noopener noreferrer"
              style={{ padding: 12 }}
              target="_blank"
              onClick={async (event) => {
                if (
                  !file.url ||
                  new URL(file.url, window.location.origin).origin === window.location.origin
                )
                  return;
                event.preventDefault();
                try {
                  await downloadFile(file.url, file.name, false);
                } catch {
                  toast.error(t('shareModal.fileDownloadError'));
                }
              }}
            >
              {t('shareModal.downloadOriginal')}
            </a>
          )}
        </Flexbox>
      ))}
    </Flexbox>
  );
}
