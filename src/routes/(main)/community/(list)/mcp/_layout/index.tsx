import { Outlet } from 'react-router';

import CategoryDrilldownLayout from '../../../components/CategoryDrilldownLayout';
import Category from '../features/Category';

const Layout = () => {
  return (
    <CategoryDrilldownLayout category={<Category />}>
      <Outlet />
    </CategoryDrilldownLayout>
  );
};

export default Layout;
