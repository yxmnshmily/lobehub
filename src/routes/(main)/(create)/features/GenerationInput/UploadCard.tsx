'use client';

import { Block } from '@lobehub/ui';
import { ActionIcon, toast } from '@lobehub/ui/base-ui';
import { Spin } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Plus, X } from 'lucide-react';
import type { ChangeEvent, CSSProperties } from 'react';
import { memo, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Image from '@/libs/next/Image';
import { useFileStore } from '@/store/file';

export const UPLOAD_CARD_SIZE = 64;
const ADD_CIRCLE_SIZE = 44;

export type UploadData = string | { dimensions?: { height: number; width: number }; url: string };

export const uploadCardStyles = createStaticStyles(({ css }) => ({
  addCircle: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    width: ${ADD_CIRCLE_SIZE}px;
    height: ${ADD_CIRCLE_SIZE}px;
    padding: 0;
    border: 0;
    border-radius: 50%;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgElevated};
    box-shadow:
      0 2px 8px rgb(0 0 0 / 15%),
      0 0 0 1px ${cssVar.colorBorderSecondary};

    transition: all ${cssVar.motionDurationMid} ease;

    &:hover {
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBg};
      box-shadow:
        0 2px 8px rgb(0 0 0 / 15%),
        0 0 0 1px ${cssVar.colorPrimary};
    }
  `,
  closeButton: css`
    position: absolute;
    z-index: 10;
    inset-block-start: -6px;
    inset-inline-end: -6px;

    border-radius: 50% !important;
  `,
  filledCard: css`
    cursor: pointer;

    position: relative;

    flex-shrink: 0;

    width: ${UPLOAD_CARD_SIZE}px;
    height: ${UPLOAD_CARD_SIZE}px;
    padding: 2px;
    border-radius: 6px;

    transition: all ${cssVar.motionDurationMid} ease;

    .upload-card-close {
      opacity: 0 !important;

      @media (hover: none), (pointer: coarse), (width <= 767px) {
        opacity: 1 !important;
      }
    }

    &:hover,
    &:focus-within {
      z-index: 99 !important;

      .upload-card-close {
        opacity: 1 !important;
      }
    }

    /* 手机端整卡缩半（与标题 zoom 0.5 同口径），和 + 新建卡保持一致 */
    @media (width <= 767px) {
      zoom: 0.5;
    }
  `,
  filledCardInner: css`
    position: relative;

    overflow: hidden;

    width: 100%;
    height: 100%;
    border-radius: 3px;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  label: css`
    padding-inline: 4px;

    font-size: 10px;
    line-height: 1;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
  placeholderCard: css`
    cursor: pointer;

    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;
    justify-content: center;

    width: ${UPLOAD_CARD_SIZE}px;
    height: ${UPLOAD_CARD_SIZE}px;
    padding: 0;
    border: 0;
    border-radius: 6px;

    font: inherit;
    color: ${cssVar.colorTextQuaternary};

    background: ${cssVar.colorFillTertiary};

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    /* 手机端整卡缩半，与已上传缩略图一致（2026-09-18 用户要求） */
    @media (width <= 767px) {
      zoom: 0.5;
    }
  `,
  uploadOverlay: css`
    position: absolute;
    z-index: 5;
    inset: 0;

    display: flex;
    align-items: center;
    justify-content: center;

    border-radius: 3px;

    background: ${cssVar.colorBgMask};

    /* antd resets the Spin's own color to colorText (near-black in the light
       theme) and the percent ring's stroke is \`currentcolor\`, so it smears into
       the dark mask. The mask is a dark scrim in both themes — override the Spin
       color to white for contrast. */
    .ant-spin {
      color: ${cssVar.colorWhite};
    }
  `,
}));

interface UploadCardProps {
  className?: string;
  closeClassName?: string;
  imageUrl?: string | null;
  label?: string;
  /** Show an upload spinner overlay (for externally-managed batch uploads). */
  loading?: boolean;
  maxFileSize?: number;
  /** Allow selecting multiple files at once (requires `onUploadFiles`). */
  multiple?: boolean;
  onRemove: () => void;
  onUpload: (data: UploadData) => void;
  /**
   * Batch upload handler. When provided, file selection is delegated to the
   * parent (which uploads + lands all files together) instead of the card's
   * internal single-file upload, enabling multi-select.
   */
  onUploadFiles?: (files: File[]) => void | Promise<void>;
  style?: CSSProperties;
  variant?: 'card' | 'circle';
}

const UploadCard = memo<UploadCardProps>(
  ({
    imageUrl,
    label,
    loading = false,
    onUpload,
    onUploadFiles,
    onRemove,
    maxFileSize,
    multiple = false,
    className,
    closeClassName,
    style,
    variant = 'card',
  }) => {
    const { t } = useTranslation(['common', 'error', 'components']);
    const inputRef = useRef<HTMLInputElement>(null);
    const uploadWithProgress = useFileStore((s) => s.uploadWithProgress);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadPreview, setUploadPreview] = useState<string | null>(null);

    // Combine internal single-upload spinner with externally-driven batch loading.
    const uploading = isUploading || loading;

    const handleFileSelect = useCallback(() => {
      if (uploading) return;
      inputRef.current?.click();
    }, [uploading]);

    const handleFileChange = useCallback(
      async (e: ChangeEvent<HTMLInputElement>) => {
        // When a batch handler is provided, delegate all selected files to the
        // parent so multiple references can be uploaded and landed at once.
        if (onUploadFiles) {
          const files = Array.from(e.target.files ?? []);
          if (files.length === 0) return;
          try {
            await onUploadFiles(files);
          } catch {
            toast.error(t('upload.uploadFailed', { ns: 'error' }));
          }
          return;
        }

        const file = e.target.files?.[0];
        if (!file) return;

        if (maxFileSize && file.size > maxFileSize) {
          toast.error(t('MultiImagesUpload.validation.fileSizeExceeded', { ns: 'components' }));
          return;
        }

        const previewUrl = URL.createObjectURL(file);
        setUploadPreview(previewUrl);
        setIsUploading(true);

        try {
          const result = await uploadWithProgress({
            file,
            onStatusUpdate: () => {},
            skipCheckFileType: true,
          });

          if (result?.url) {
            const data = result.dimensions
              ? { dimensions: result.dimensions, url: result.url }
              : result.url;
            onUpload(data);
          } else {
            toast.error(t('upload.uploadFailed', { ns: 'error' }));
          }
        } catch {
          toast.error(t('upload.uploadFailed', { ns: 'error' }));
        } finally {
          URL.revokeObjectURL(previewUrl);
          setUploadPreview(null);
          setIsUploading(false);
        }
      },
      [maxFileSize, uploadWithProgress, onUpload, onUploadFiles, t],
    );

    const showPreview = uploadPreview || imageUrl;

    const fileInput = (
      <input
        accept="image/*"
        multiple={multiple}
        ref={inputRef}
        style={{ display: 'none' }}
        type="file"
        onChange={handleFileChange}
        onClick={(e) => {
          e.currentTarget.value = '';
        }}
      />
    );

    if (variant === 'circle' && !showPreview) {
      return (
        <>
          {fileInput}
          <button
            aria-label={t('addNew')}
            className={`${uploadCardStyles.addCircle} ${className || ''}`}
            disabled={uploading}
            style={style}
            type="button"
            onClick={handleFileSelect}
          >
            <Plus size={14} />
          </button>
        </>
      );
    }

    if (showPreview) {
      return (
        <>
          {fileInput}
          <Block
            className={cx(uploadCardStyles.filledCard, className)}
            style={style}
            variant={'outlined'}
          >
            <div
              aria-disabled={uploading}
              aria-label={label || t('edit')}
              className={uploadCardStyles.filledCardInner}
              role="button"
              tabIndex={uploading ? -1 : 0}
              onClick={handleFileSelect}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleFileSelect();
                }
              }}
            >
              <Image
                fill
                unoptimized
                alt=""
                src={uploadPreview || imageUrl!}
                style={{ objectFit: 'contain' }}
              />
              {uploading && (
                <div className={uploadCardStyles.uploadOverlay}>
                  <Spin percent={'auto'} size="small" />
                </div>
              )}
            </div>
            {!uploading && (
              <ActionIcon
                glass
                aria-label={t('delete')}
                className={cx(uploadCardStyles.closeButton, closeClassName, 'upload-card-close')}
                icon={X}
                size={12}
                style={{ minHeight: 44, minWidth: 44 }}
                variant="outlined"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
              />
            )}
          </Block>
        </>
      );
    }

    return (
      <>
        {fileInput}
        <button
          aria-label={label || t('addNew')}
          className={cx(uploadCardStyles.placeholderCard, className)}
          disabled={uploading}
          style={style}
          type="button"
          onClick={handleFileSelect}
        >
          <Plus size={20} />
          {label && <span className={uploadCardStyles.label}>{label}</span>}
        </button>
      </>
    );
  },
);

UploadCard.displayName = 'UploadCard';

export default UploadCard;
