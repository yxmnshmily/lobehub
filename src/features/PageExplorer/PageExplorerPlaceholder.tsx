import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import { Notion } from '@lobehub/icons';
import { Center, FileTypeIcon, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { Upload } from 'antd';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { ArrowUpIcon, PlusIcon } from 'lucide-react';
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NavHeader from '@/features/NavHeader';
import useNotionImport from '@/features/ResourceManager/components/Header/hooks/useNotionImport';
import { usePermission } from '@/hooks/usePermission';
import { useFileStore } from '@/store/file';
import { usePageStore } from '@/store/page';
import { DocumentSourceType } from '@/types/document';
import { standardizeIdentifier } from '@/utils/identifier';

const ICON_SIZE = 80;

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, 200px);
    gap: 12px;
    justify-content: center;

    width: 100%;
    padding-inline: 16px;

    @media (width <= 767px) {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      max-width: 520px;
      padding-inline: 12px;
    }
  `,
  actionTitle: css`
    margin-block-start: 12px;
    font-size: 16px;
    color: ${cssVar.colorTextSecondary};

    @media (width <= 767px) {
      margin-block-start: 8px;
      font-size: clamp(12px, 3.4vw, 14px);
      line-height: 1.3;
    }
  `,
  card: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 200px;
    height: 140px;
    padding: 16px;
    border: 0;
    border-radius: ${cssVar.borderRadiusLG};

    font: inherit;
    font-weight: 500;
    color: inherit;
    text-align: center;

    appearance: none;
    background: ${cssVar.colorFillTertiary};
    box-shadow: 0 0 0 1px ${cssVar.colorFillTertiary} inset;

    transition: background 0.3s ease-in-out;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    @media (width <= 767px) {
      width: 100%;
      min-width: 0;
      height: 112px;
      padding: 8px;
    }
  `,
  glow: css`
    position: absolute;
    inset-block-end: -12px;
    inset-inline-end: 0;

    width: 48px;
    height: 48px;

    opacity: 0.5;
    filter: blur(24px);
  `,
  icon: css`
    position: absolute;
    z-index: 1;
    inset-block-end: -24px;
    inset-inline-end: 8px;

    flex: none;

    @media (width <= 767px) {
      inset-block-end: -16px;
      inset-inline-end: 4px;
    }
  `,
}));

interface PageExplorerPlaceholderProps {
  hasPages?: boolean;
  knowledgeBaseId?: string;
}

const PageExplorerPlaceholder = memo<PageExplorerPlaceholderProps>(
  ({ hasPages = false, knowledgeBaseId }) => {
    const { t } = useTranslation(['file', 'common']);
    const { mobile = false } = useResponsive();
    const { allowed: canCreate } = usePermission('create_content');
    const [isUploading, setIsUploading] = useState(false);

    // Page-specific operations from pageStore
    const [
      createNewPage,
      createOptimisticPage,
      replaceTempPageWithReal,
      setSelectedPageId,
      fetchDocuments,
    ] = usePageStore((s) => [
      s.createNewPage,
      s.createOptimisticPage,
      s.replaceTempPageWithReal,
      s.setSelectedPageId,
      s.fetchDocuments,
    ]);

    // File operations from FileStore (for uploads and notion import)
    const [createDocument] = useFileStore((s) => [s.createDocument]);

    const notionImport = useNotionImport({
      createDocument,
      currentFolderId: null,
      libraryId: knowledgeBaseId ?? null,
      refetchResources: fetchDocuments,
      t,
    });

    // Wrap handleNotionImport to ensure UI updates
    const handleNotionImportWithLocalUpdate = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      if (!canCreate) return;

      await notionImport.handleNotionImport(event);
    };

    const handleCreateDocument = async (content: string, title: string) => {
      if (!canCreate) return;

      if (!content) {
        // For empty pages, use createNewPage which handles optimistic updates
        await createNewPage(title);
        return;
      }

      // For markdown uploads with content, use optimistic pattern similar to createNewPage
      const tempPageId = createOptimisticPage(title);
      // Set selected page to temp ID immediately (with URL update disabled for temp IDs)
      setSelectedPageId(tempPageId, false);

      try {
        const newDoc = await createDocument({
          content,
          knowledgeBaseId,
          title,
        });

        // Convert to LobeDocument format
        const realPage = {
          content: newDoc.content || '',
          createdAt: newDoc.createdAt ? new Date(newDoc.createdAt) : new Date(),
          editorData:
            typeof newDoc.editorData === 'string'
              ? JSON.parse(newDoc.editorData)
              : newDoc.editorData || null,
          fileType: CUSTOM_DOCUMENT_FILE_TYPE,
          filename: newDoc.title || title,
          id: newDoc.id,
          metadata: newDoc.metadata || {},
          source: 'document' as const,
          sourceType: DocumentSourceType.EDITOR,
          title: newDoc.title || title,
          totalCharCount: newDoc.content?.length || 0,
          totalLineCount: 0,
          updatedAt: newDoc.updatedAt ? new Date(newDoc.updatedAt) : new Date(),
        };

        // Replace optimistic with real
        replaceTempPageWithReal(tempPageId, realPage);
        // Update selected page ID and URL to the real page
        setSelectedPageId(newDoc.id);
      } catch (error) {
        console.error('Failed to create page:', error);
        // Remove temp document on error
        usePageStore.getState().removeTempPage(tempPageId);
        setSelectedPageId(null);
        throw error;
      }
    };

    const handleUploadFile = async (file: File) => {
      if (!canCreate) return false;

      try {
        setIsUploading(true);

        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        // For markdown files, read content directly
        if (fileExtension === 'md' || fileExtension === 'markdown') {
          const content = await file.text();
          await handleCreateDocument(content, file.name.replace(/\.md$|\.markdown$/i, ''));
        }
        // For PDF and DOCX files, upload to server and parse
        else if (fileExtension === 'pdf' || fileExtension === 'docx') {
          const fileName = file.name.replace(/\.(pdf|docx)$/i, '');

          // Create optimistic document but don't select it yet
          const tempPageId = createOptimisticPage(fileName);

          try {
            // Upload file to server
            const uploadResult = await useFileStore.getState().uploadWithProgress({
              file,
              knowledgeBaseId,
            });

            if (!uploadResult) {
              throw new Error('Failed to upload file');
            }

            // Parse file as document on server - this creates a clean document from the file
            const { lambdaClient } = await import('@/libs/trpc/client');
            const parsedDocument = await lambdaClient.document.parseDocument.mutate({
              id: uploadResult.id,
            });

            // Convert to LobeDocument format
            const realPage = {
              content: parsedDocument.content || '',
              createdAt: parsedDocument.createdAt ? new Date(parsedDocument.createdAt) : new Date(),
              editorData:
                typeof parsedDocument.editorData === 'string'
                  ? JSON.parse(parsedDocument.editorData)
                  : parsedDocument.editorData || null,
              fileType: parsedDocument.fileType || CUSTOM_DOCUMENT_FILE_TYPE,
              filename: parsedDocument.filename || fileName,
              id: parsedDocument.id,
              metadata: parsedDocument.metadata || {},
              source: parsedDocument.source || 'document',
              sourceType: parsedDocument.sourceType || 'file',
              title: parsedDocument.title || fileName,
              totalCharCount: parsedDocument.totalCharCount || 0,
              totalLineCount: parsedDocument.totalLineCount || 0,
              updatedAt: parsedDocument.updatedAt ? new Date(parsedDocument.updatedAt) : new Date(),
            };

            // Replace optimistic with real document in the store
            replaceTempPageWithReal(tempPageId, realPage);

            // Update selected page ID in store (with full ID including prefix)
            setSelectedPageId(parsedDocument.id, false);

            // Update URL with stripped ID (without prefix)
            const cleanId = standardizeIdentifier(parsedDocument.id);
            const newPath = cleanId ? `/page/${cleanId}` : '/page';
            window.history.replaceState({}, '', newPath);
          } catch (error) {
            console.error('Failed to upload and parse file:', error);
            // Remove temp document on error
            usePageStore.getState().removeTempPage(tempPageId);
            throw error;
          }
        }
      } catch (error) {
        console.error('Failed to upload file:', error);
      } finally {
        setIsUploading(false);
      }

      return false; // Prevent default upload behavior
    };

    return (
      <>
        <NavHeader />
        <Center
          gap={mobile ? 12 : 24}
          height={'100%'}
          style={{ paddingBottom: 'max(32px, env(safe-area-inset-bottom))' }}
          width={'100%'}
        >
          {hasPages && (
            <Flexbox justify={'center'} style={{ textAlign: 'center' }}>
              <Text as={'h4'}>{t('pageEditor.empty.title')}</Text>
              <Text type={'secondary'}>{t('or', { ns: 'common' })}</Text>
            </Flexbox>
          )}
          <div className={styles.actions}>
            <button
              aria-label={t('pageEditor.empty.createNewDocument')}
              className={styles.card}
              disabled={!canCreate}
              type="button"
              onClick={() => handleCreateDocument('', t('pageList.untitled'))}
            >
              <span className={styles.actionTitle}>{t('pageEditor.empty.createNewDocument')}</span>
              <div className={styles.glow} style={{ background: cssVar.purple }} />
              <FileTypeIcon
                className={styles.icon}
                color={cssVar.purple}
                icon={<Icon color={'#fff'} icon={PlusIcon} />}
                size={mobile ? 56 : ICON_SIZE}
                type={'file'}
              />
            </button>

            {/* Upload Files (PDF, DOCX, Markdown) */}
            <Upload
              accept=".md,.markdown,.pdf,.docx"
              beforeUpload={handleUploadFile}
              disabled={!canCreate || isUploading}
              multiple={false}
              showUploadList={false}
            >
              <button
                aria-label={t('pageEditor.empty.uploadFiles')}
                className={styles.card}
                disabled={!canCreate || isUploading}
                type="button"
              >
                <span className={styles.actionTitle}>
                  {isUploading ? 'Uploading...' : t('pageEditor.empty.uploadFiles')}
                </span>
                <div className={styles.glow} style={{ background: cssVar.gold }} />
                <FileTypeIcon
                  className={styles.icon}
                  color={cssVar.gold}
                  icon={<Icon color={'#fff'} icon={ArrowUpIcon} />}
                  size={mobile ? 56 : ICON_SIZE}
                  type={'file'}
                />
              </button>
            </Upload>

            {/* Import from Notion */}
            <button
              aria-label={t('pageEditor.empty.importNotion')}
              className={styles.card}
              disabled={!canCreate}
              type="button"
              onClick={() => {
                if (!canCreate) return;

                notionImport.handleOpenNotionGuide();
              }}
            >
              <span className={styles.actionTitle}>{t('pageEditor.empty.importNotion')}</span>
              <div className={styles.glow} style={{ background: cssVar.geekblue }} />
              <FileTypeIcon
                className={styles.icon}
                color={cssVar.geekblue}
                icon={<Notion color={'#fff'} />}
                size={mobile ? 56 : ICON_SIZE}
                type={'file'}
              />
            </button>
          </div>
        </Center>
        <input
          accept=".zip"
          ref={notionImport.notionInputRef}
          style={{ display: 'none' }}
          type="file"
          onChange={handleNotionImportWithLocalUpdate}
        />
      </>
    );
  },
);

export default PageExplorerPlaceholder;
