import { downloadFile, exportFile } from '@lobechat/utils/client';
import { Flexbox } from '@lobehub/ui';
import { Button, createModal, toast } from '@lobehub/ui/base-ui';
import { Download, ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getRegisteredAttachment } from '@/features/EditorCanvas/attachmentRegistry';
import { getFileDownloadUrl } from '@/features/EditorCanvas/fileDownload';

import { defineAction } from '../defineAction';
import {
  getMessageDownloads,
  getMessageExportText,
  type MessageDownload,
} from '../messageDownloads';

export const downloadAction = defineAction({
  key: 'download',
  useBuild: ({ data, id }) => {
    const { t } = useTranslation('common');
    return {
      key: 'download',
      icon: Download,
      label: t('download'),
      handleClick: () => {
        const content = getMessageExportText(data);
        const files = getMessageDownloads(data);
        const saveText = () => exportFile(content, `message-${id.replaceAll(/[^\w-]/g, '_')}.txt`);
        const saveFile = async (file: MessageDownload) => {
          const attachment = getRegisteredAttachment(file.url);
          const url = getFileDownloadUrl(file.url, {
            appOrigin: window.location.origin,
            fileId: attachment?.fileId,
            downloadUrl: attachment?.downloadUrl,
          });
          if (
            url !== file.url ||
            new URL(url, window.location.href).searchParams.get('download') === '1'
          ) {
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
          }
          try {
            await downloadFile(url, file.name, false);
          } catch {
            toast.error('文件下载失败，请重试或打开原文件保存。');
          }
        };
        if (!files.length && content) {
          saveText();
          return;
        }
        if (!files.length) {
          toast.info('这条消息暂无可下载的内容。');
          return;
        }
        createModal({
          title: t('download'),
          width: 'min(480px, calc(100vw - 32px))',
          footer: null,
          content: (
            <Flexbox gap={8} style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {content && (
                <Button icon={FileText} onClick={saveText}>
                  下载文本（TXT）
                </Button>
              )}
              {files.map((file, index) => (
                <Flexbox horizontal gap={8} key={file.url}>
                  <Button
                    icon={Download}
                    title={file.name}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      height: 'auto',
                      minHeight: 36,
                      whiteSpace: 'normal',
                      overflowWrap: 'anywhere',
                    }}
                    onClick={() => void saveFile(file)}
                  >
                    {index + 1}. {file.name}
                  </Button>
                  <Button
                    aria-label={`打开原文件：${file.name}`}
                    icon={ExternalLink}
                    title="打开原文件"
                    onClick={() => window.open(file.url, '_blank', 'noopener,noreferrer')}
                  />
                </Flexbox>
              ))}
            </Flexbox>
          ),
        });
      },
    };
  },
});
