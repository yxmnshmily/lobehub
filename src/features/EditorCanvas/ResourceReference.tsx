'use client';

import { useLexicalComposerContext } from '@lobehub/editor';
import { createModal } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { $getNearestNodeFromDOMNode, $getRoot, type LexicalEditor } from 'lexical';
import { lazy, Suspense, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import AsyncError from '@/components/AsyncError';
import FileIcon from '@/components/FileIcon';
import { openDocumentModal } from '@/features/DocumentModal/loader';
import { fileService } from '@/services/file';

const FileViewer = lazy(() => import('@/features/FileViewer'));

const styles = createStaticStyles(({ css, cssVar }) => ({
  reference: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    max-width: 100%;
    padding-block: 3px;
    padding-inline: 6px;
    border: 0.5px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;

    font: inherit;
    color: ${cssVar.colorLink};
    text-align: start;
    vertical-align: middle;

    background: ${cssVar.colorFillTertiary};

    & span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    & img {
      flex-shrink: 0;
      object-fit: contain;
    }
  `,
}));

export const ResourceReference = ({ id }: { id: string }) => {
  const { t } = useTranslation('file');
  const { data, error, mutate } = useSWR(
    ['editor-resource-reference', id],
    () => fileService.getKnowledgeItem(id),
    {
      shouldRetryOnError: false,
    },
  );
  const open = () => {
    if (error || data === null) {
      createModal({
        title: t('notFound.title'),
        content: (
          <AsyncError
            error={error || new Error(t('notFound.title'))}
            onRetry={() => void mutate()}
          />
        ),
        footer: null,
      });
      return;
    }
    if (!data) return;
    if (id.startsWith('docs_')) {
      void openDocumentModal(id);
      return;
    }
    createModal({
      content: (
        <div style={{ height: '70vh', minHeight: 0, overflow: 'auto' }}>
          <Suspense fallback={null}>
            <FileViewer {...data} />
          </Suspense>
        </div>
      ),
      footer: null,
      title: data.name,
      width: 'min(90vw, 1000px)',
    });
  };
  return (
    <button
      aria-label={error || data === null ? t('notFound.title') : data?.name || id}
      className={styles.reference}
      contentEditable={false}
      title={data?.name || id}
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
      }}
    >
      {data?.fileType?.startsWith('image/') && data.url ? (
        <img alt="" height={112} src={data.url} width={112} />
      ) : (
        <FileIcon fileName={data?.name || id} fileType={data?.fileType} size={20} />
      )}
    </button>
  );
};

interface ReferenceSlot {
  element: HTMLElement;
  id: string;
}

// Enhance the existing code element using attributes only: Lexical owns its DOM
// children, and the document's JSON/Markdown must not change when previewing it.
const observeReferences = (editor: LexicalEditor) => {
  let slots: ReferenceSlot[] = [];
  let disposed = false;
  const items = new Map<string, Awaited<ReturnType<typeof fileService.getKnowledgeItem>>>();
  const pending = new Set<string>();
  const clear = (element: HTMLElement) => {
    for (const name of [
      'data-resource-reference',
      'data-resource-name',
      'data-resource-thumbnail',
      'aria-label',
      'role',
      'tabindex',
      'title',
    ])
      element.removeAttribute(name);
    element.style.removeProperty('--resource-thumbnail');
  };
  const decorate = (slot: ReferenceSlot) => {
    slot.element.setAttribute('data-resource-reference', slot.id);
    slot.element.setAttribute('role', 'button');
    slot.element.setAttribute('tabindex', '0');
    const item = items.get(slot.id);
    if (item) {
      const icon = item.fileType?.startsWith('image/')
        ? '▧'
        : item.fileType?.startsWith('video/')
          ? '▷'
          : '▤';
      slot.element.setAttribute('data-resource-name', icon);
      slot.element.setAttribute('aria-label', item.name);
      if (item.fileType?.startsWith('image/') && item.url) {
        slot.element.setAttribute('data-resource-thumbnail', 'true');
        slot.element.style.setProperty('--resource-thumbnail', `url(${JSON.stringify(item.url)})`);
      }
      slot.element.setAttribute('title', item.name);
    }
  };
  const scan = () => {
    if (disposed) return;
    const next: ReferenceSlot[] = [];
    const seen = new Set<string>();
    editor.read(() => {
      for (const text of $getRoot().getAllTextNodes()) {
        const node = text.getParent();
        if (node?.getType() !== 'codeInline' || seen.has(node.getKey())) continue;
        seen.add(node.getKey());
        const id = node.getTextContent().replaceAll('\uFEFF', '');
        if (!/^(?:file|docs)_[\w-]+$/.test(id)) continue;
        const element = editor.getElementByKey(node.getKey());
        if (element) next.push({ element, id });
      }
    });
    for (const slot of slots)
      if (!next.some((n) => n.element === slot.element)) clear(slot.element);
    slots = next;
    for (const slot of slots) {
      decorate(slot);
      if (pending.has(slot.id)) continue;
      pending.add(slot.id);
      void fileService
        .getKnowledgeItem(slot.id)
        .then((item) => {
          if (disposed) return;
          items.set(slot.id, item);
          for (const current of slots) if (current.id === slot.id) decorate(current);
        })
        .catch(() => {
          /* The preview displays the authoritative access error and retry action. */
        });
    }
  };
  // Keep a thumbnail press from restoring Lexical's old caret and scrolling
  // its target away before the click. Opening remains a click/keyboard action.
  const preventCaret = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const reference = target.closest('[data-resource-reference]');
    let isImage = false;
    if (!reference && target instanceof HTMLImageElement && !target.closest('button')) {
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        isImage = !!node && ['image', 'block-image'].includes(node.getType());
      });
    }
    if (!reference && !isImage) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const activate = (event: Event) => {
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return;
    const element =
      event.target instanceof Element ? event.target.closest('[data-resource-reference]') : null;
    const slot = slots.find((s) => s.element === element);
    if (!slot) {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || target.closest('button')) return;
      let imageNode = false;
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(target);
        imageNode = !!node && ['image', 'block-image'].includes(node.getType());
      });
      if (!imageNode) return;
      event.preventDefault();
      event.stopPropagation();
      createModal({
        title: target.alt || '图片预览',
        content: (
          <img
            alt={target.alt}
            src={target.currentSrc || target.src}
            style={{
              display: 'block',
              margin: 'auto',
              maxHeight: '75vh',
              maxWidth: '100%',
              objectFit: 'contain',
            }}
          />
        ),
        footer: null,
        width: 'min(90vw, 1000px)',
      });
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (slot.id.startsWith('docs_')) {
      void openDocumentModal(slot.id);
      return;
    }
    createModal({
      title: items.get(slot.id)?.name || slot.id,
      content: <ResourcePreview id={slot.id} />,
      footer: null,
      width: 'min(90vw, 1000px)',
    });
  };
  const removeRoot = editor.registerRootListener((root, prev) => {
    prev?.removeEventListener('pointerdown', preventCaret, true);
    prev?.removeEventListener('mousedown', preventCaret, true);
    prev?.removeEventListener('click', activate, true);
    prev?.removeEventListener('keydown', activate, true);
    root?.addEventListener('pointerdown', preventCaret, true);
    root?.addEventListener('mousedown', preventCaret, true);
    root?.addEventListener('click', activate, true);
    root?.addEventListener('keydown', activate, true);
    scan();
  });
  const removeUpdate = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
    if (dirtyElements.size || dirtyLeaves.size) scan();
  });
  return () => {
    disposed = true;
    removeRoot();
    removeUpdate();
    editor.getRootElement()?.removeEventListener('pointerdown', preventCaret, true);
    editor.getRootElement()?.removeEventListener('mousedown', preventCaret, true);
    editor.getRootElement()?.removeEventListener('click', activate, true);
    editor.getRootElement()?.removeEventListener('keydown', activate, true);
    for (const slot of slots) clear(slot.element);
  };
};
const ResourcePreview = ({ id }: { id: string }) => {
  const { t } = useTranslation('file');
  const { data, error, mutate } = useSWR(
    ['editor-resource-reference', id],
    () => fileService.getKnowledgeItem(id),
    { shouldRetryOnError: false },
  );
  if (error || data === null)
    return (
      <AsyncError error={error || new Error(t('notFound.title'))} onRetry={() => void mutate()} />
    );
  if (!data) return <span>{id}</span>;
  if (id.startsWith('docs_')) return <ResourceReference id={id} />;
  return (
    <>
      <div style={{ height: '70vh', overflow: 'auto' }}>
        <Suspense fallback={null}>
          <FileViewer {...data} />
        </Suspense>
      </div>
    </>
  );
};
class ResourceReferenceObserver {
  static pluginName = 'ResourceReferenceObserver';
  private clear?: () => void;
  onInit(editor: LexicalEditor) {
    this.clear = observeReferences(editor);
  }
  destroy() {
    this.clear?.();
  }
}
export default function ReactResourceReferencePlugin() {
  const [kernel] = useLexicalComposerContext();
  useLayoutEffect(() => {
    kernel.registerPlugin(ResourceReferenceObserver);
  }, [kernel]);
  return null;
}
