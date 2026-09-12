import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import ResourceHomeDashboard from './index';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/store/library', () => ({
  useKnowledgeBaseStore: (selector: (state: unknown) => unknown) =>
    selector({ useFetchKnowledgeBaseList: () => ({ data: [] }) }),
}));
vi.mock('@/features/NavHeader', () => ({ default: () => null }));
vi.mock('@/features/ResourceManager/components/Header/AddButton', () => ({ default: () => null }));
vi.mock('./Libraries', () => ({ default: () => null }));
vi.mock('./RecentWorks', () => ({ default: () => null }));
vi.mock('./RecentFiles', async () => {
  const { useKnowledgeBaseListContext } =
    await import('@/features/ResourceManager/components/KnowledgeBaseListProvider');
  return {
    default: function RecentFilesMock() {
      const libraries = useKnowledgeBaseListContext();
      return <span>资源库上下文已就绪：{libraries.length}</span>;
    },
  };
});
// 首页不再展示「最近文稿」。这里给一个可见的替身：一旦有人把它加回组成，
// 下面的断言会立刻失败。
vi.mock('./RecentPages', () => ({ default: () => <span>最近文稿区块</span> }));

it('provides library context to resource home quick actions', () => {
  render(<ResourceHomeDashboard />);
  expect(screen.getByText('资源库上下文已就绪：0')).toBeInTheDocument();
});

it('does not render the recent pages section on the resource home', () => {
  render(<ResourceHomeDashboard />);
  expect(screen.queryByText('最近文稿区块')).not.toBeInTheDocument();
});

it('lets every resource-home section shrink to the mobile content width', () => {
  render(<ResourceHomeDashboard />);

  const stylesheet = [...document.querySelectorAll('style')]
    .map((style) => style.textContent)
    .join('')
    .replaceAll(' ', '');

  // 断契约而不是断序列化顺序：章节容器的「子元素可收缩」规则必须同时含
  // min-width:0 与 width:100%（antd-style 序列化时两者先后顺序会变，按顺序
  // 断言会在调整章节顺序时误报）。
  const shrinkRule = (stylesheet.match(/>\*\{[^}]*\}/g) || []).find(
    (block) => block.includes('min-width:0') && block.includes('width:100%'),
  );
  expect(shrinkRule).toBeTruthy();
  expect(stylesheet).toContain(
    'padding-inline:var(--mobile-page-inner-gutter,var(--mobile-page-gutter,10px))',
  );
});
