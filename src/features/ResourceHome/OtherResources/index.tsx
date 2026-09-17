'use client';

import { Flexbox } from '@lobehub/ui';
import { ActionIcon, Checkbox, confirmModal, Input, toast } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowDownAZ, ArrowUpAZ, LayoutGrid, List, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SWRConfig } from 'swr';

import AsyncError from '@/components/AsyncError';
import NavHeader from '@/features/NavHeader';
import { useResourceManagerUrlSync } from '@/features/ResourceManager/hooks/useResourceManagerUrlSync';
import { WorkGalleryCardsSkeleton } from '@/features/WorkGallery/Skeleton';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';
import WorkPreviewCard from '@/features/WorkGallery/WorkPreviewCard';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { workService } from '@/services/work';

import { useOtherWorks } from './useOtherWorks';

const styles = createStaticStyles(({ css }) => ({
  content: css`
    overflow-y: auto;
    min-height: 0;
    padding: 24px;

    @media (width <= 767px) {
      padding-inline: var(--mobile-page-inner-gutter, var(--mobile-page-gutter, 10px));
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: 16px;
    align-items: start;
  `,
}));

/**
 * 「其他」这一页装的是 agent 产出的作品（Work），不是上传的文件：整页按作品展示，
 * 与侧栏计数共用完整作品数据，保留 WorkPreviewCard 的打开、复制、下载和删除入口。
 */
function OtherResourcesContent() {
  const { t } = useTranslation(['file', 'common']);
  const openWork = useOpenWork();
  useFetchAgentList();
  useResourceManagerUrlSync();

  const {
    data: items = [],
    error,
    isLoading: isLoadingInitial,
    isValidating,
    mutate: reload,
  } = useOtherWorks();
  const [search, setSearch] = useState('');
  const [descending, setDescending] = useState(false);
  const [listView, setListView] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const visibleItems = useMemo(
    () =>
      items
        .filter((item) =>
          (item.title || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
        )
        .sort((a, b) => (a.title || '').localeCompare(b.title || '') * (descending ? -1 : 1)),
    [items, search, descending],
  );
  const selectedItems = visibleItems.filter((item) => selected.includes(item.id));
  const allSelected = visibleItems.length > 0 && selectedItems.length === visibleItems.length;
  const summary = selectedItems.length
    ? `已选中 ${selectedItems.length} 项`
    : `共 ${visibleItems.length} 项`;

  return (
    <Flexbox height="100%" style={{ minHeight: 0 }}>
      <NavHeader
        style={{ borderBottom: `0.5px solid ${cssVar.colorBorderSecondary}` }}
        left={
          <Flexbox horizontal align="center" gap={12} style={{ whiteSpace: 'nowrap' }}>
            <span>{t('tab.other')}</span>
            <Checkbox
              aria-label="全选作品"
              checked={allSelected}
              disabled={!visibleItems.length}
              indeterminate={selectedItems.length > 0 && !allSelected}
              onChange={(checked) =>
                setSelected(checked ? visibleItems.map((item) => item.id) : [])
              }
            />
            <span aria-live="polite">{summary}</span>
            {!!selectedItems.length && (
              <ActionIcon
                icon={Trash2}
                title="删除选中作品"
                onClick={() =>
                  confirmModal({
                    title: '删除选中作品',
                    content: `确认删除 ${selectedItems.length} 个作品？`,
                    onOk: async () => {
                      try {
                        for (const item of selectedItems) await workService.deleteWork(item.id);
                        setSelected([]);
                      } catch {
                        toast.error('部分作品未能删除，请重试');
                      } finally {
                        await reload();
                      }
                    },
                  })
                }
              />
            )}
          </Flexbox>
        }
        right={
          <Flexbox horizontal align="center" gap={4} wrap="wrap">
            <Input
              aria-label="搜索作品"
              placeholder="搜索作品"
              prefix={<Search size={16} />}
              style={{ width: 180 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <ActionIcon
              icon={descending ? ArrowUpAZ : ArrowDownAZ}
              title="切换名称排序"
              onClick={() => setDescending(!descending)}
            />
            <ActionIcon
              icon={listView ? LayoutGrid : List}
              title={listView ? '网格视图' : '列表视图'}
              onClick={() => setListView(!listView)}
            />
            <ActionIcon
              icon={RefreshCw}
              loading={isValidating}
              title="刷新作品"
              onClick={() => void reload()}
            />
          </Flexbox>
        }
      />
      <Flexbox className={styles.content} flex={1} gap={16}>
        {error && <AsyncError error={error} variant="inline" onRetry={() => void reload()} />}
        {isLoadingInitial && items.length === 0 && !error ? (
          <WorkGalleryCardsSkeleton />
        ) : (
          <div
            className={styles.grid}
            style={listView ? { gridTemplateColumns: '1fr' } : undefined}
          >
            {visibleItems.map((item) => (
              <div key={item.id}>
                <Checkbox
                  aria-label={`选择 ${item.title}`}
                  checked={selected.includes(item.id)}
                  onChange={(checked) =>
                    setSelected((ids) =>
                      checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                    )
                  }
                />
                <WorkPreviewCard
                  item={item}
                  key={item.id}
                  onDeleted={() => void reload()}
                  onOpen={openWork}
                />
              </div>
            ))}
          </div>
        )}
        {!isLoadingInitial && !error && visibleItems.length === 0 && (
          <span>{search ? '没有匹配的作品' : t('empty')}</span>
        )}
      </Flexbox>
    </Flexbox>
  );
}

export default function OtherResources() {
  // This feed handles its own errors locally; an inherited suspense boundary would
  // discard successfully loaded cards when a later page fails.
  return (
    <SWRConfig value={{ suspense: false, shouldRetryOnError: false }}>
      <OtherResourcesContent />
    </SWRConfig>
  );
}
