'use client';

import { Flexbox } from '@lobehub/ui';
import { FileText, FolderArchive, ImageIcon, LayoutGridIcon, SquarePlay } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useBusinessResourceCategories } from '@/business/client/features/ResourceCategories';
import NavItem from '@/features/NavPanel/components/NavItem';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { FilesTabs } from '@/types/files';

const CategoryMenu = memo(() => {
  const { t } = useTranslation('file');
  const setMode = useResourceManagerStore((s) => s.setMode);
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  const businessCategories = useBusinessResourceCategories();
  const pathname = location.pathname.replace(/\/$/, '');
  const isActive = (url: string) => pathname === url || pathname.endsWith(url);
  const items = [
    { icon: LayoutGridIcon, key: FilesTabs.Home, title: t('tab.all'), url: '/resource' },
    {
      icon: FileText,
      key: FilesTabs.Documents,
      title: t('tab.documents'),
      url: '/resource/documents',
    },
    { icon: ImageIcon, key: FilesTabs.Images, title: t('tab.images'), url: '/resource/images' },
    { icon: SquarePlay, key: FilesTabs.Videos, title: t('tab.videos'), url: '/resource/videos' },
    { icon: FolderArchive, key: FilesTabs.Other, title: t('tab.other'), url: '/resource/other' },
    ...businessCategories.map((category) => ({
      ...category,
      title: t(category.titleKey as never) as string,
    })),
  ];

  return (
    <Flexbox gap={1} paddingInline={4}>
      {items.map((item) => (
        <Link
          aria-current={isActive(item.url) ? 'page' : undefined}
          key={item.key}
          to={item.url}
          onClick={(event) => {
            event.preventDefault();
            setMode('explorer');
            navigate(item.url, { replace: true });
          }}
        >
          <NavItem active={isActive(item.url)} icon={item.icon} title={item.title} />
        </Link>
      ))}
    </Flexbox>
  );
});

CategoryMenu.displayName = 'CategoryMenu';
export default CategoryMenu;
