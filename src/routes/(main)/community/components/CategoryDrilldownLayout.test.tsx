// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import CategoryDrilldownLayout from './CategoryDrilldownLayout';

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/community/agent${search}`]}>
      <Routes>
        <Route
          path="/community/agent"
          element={
            <CategoryDrilldownLayout category={<div>分类列表</div>}>
              <div>内容区</div>
            </CategoryDrilldownLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe('CategoryDrilldownLayout', () => {
  it('无分类参数时显示分类列表', () => {
    renderAt('');
    expect(screen.getByText('分类列表')).toBeInTheDocument();
    expect(screen.queryByText('内容区')).not.toBeInTheDocument();
  });

  it('带 category 参数时显示内容层（带返回）', () => {
    renderAt('?category=academic');
    expect(screen.getByText('内容区')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(screen.queryByText('分类列表')).not.toBeInTheDocument();
  });

  it('点返回清掉分类参数，回到分类列表', () => {
    renderAt('?category=academic');
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByText('分类列表')).toBeInTheDocument();
    expect(screen.queryByText('内容区')).not.toBeInTheDocument();
  });

  it('sort 参数（发现 tab）也视为内容层', () => {
    renderAt('?sort=recommended');
    expect(screen.getByText('内容区')).toBeInTheDocument();
  });
});
