import type { ViewMode } from '@/features/ResourceManager/store/initialState';
import { FilesTabs } from '@/types/files';

const GALLERY_FIRST_CATEGORIES = new Set<FilesTabs>([
  // 「全部」是文件管理的落地页（打开 /resource 即到这里）：默认按网格铺开
  // 预览，列表视图仍可在工具栏切换。
  FilesTabs.All,
  FilesTabs.Audios,
  FilesTabs.Images,
  FilesTabs.Videos,
  FilesTabs.Websites,
]);

export const getDefaultResourceViewMode = (category: FilesTabs, libraryId?: string): ViewMode =>
  !libraryId && GALLERY_FIRST_CATEGORIES.has(category) ? 'masonry' : 'list';
