import { Markdown, type MarkdownProps } from '@lobehub/ui';
import { type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { localizeGoalTemplate } from './localizeGoalTemplate';
import { ResourceReference } from './ResourceReference';

const ReferenceCode = ({
  children,
  node: _node,
  ...props
}: ComponentProps<'code'> & { node?: unknown }) => {
  const id = (typeof children === 'string' ? children : '').replaceAll('\uFEFF', '');
  if (/^(?:file|docs)_[\w-]+$/.test(id)) return <ResourceReference id={id} />;
  return <code {...props}>{children}</code>;
};

export default function ResourceMarkdown({ components, children, ...props }: MarkdownProps) {
  const { i18n } = useTranslation();
  return (
    <Markdown {...props} enableImageGallery components={{ code: ReferenceCode, ...components }}>
      {localizeGoalTemplate(children, i18n.resolvedLanguage || i18n.language)}
    </Markdown>
  );
}
