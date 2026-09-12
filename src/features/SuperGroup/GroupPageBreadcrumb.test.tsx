import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GroupPageBreadcrumb from './GroupPageBreadcrumb';
import { useGroupWorkRequest } from './useGroupWorkRequest';

const push = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useQueryRoute', () => ({ useQueryRoute: () => ({ push }) }));

describe('group page breadcrumb', () => {
  beforeEach(() => {
    push.mockClear();
    useGroupWorkRequest.setState({ request: null });
  });

  it.each(['目标', '任务', '项目'])('shows the shared group home header for %s', (title) => {
    useGroupWorkRequest.setState({ request: { groupId: 'group-1', kind: 'goals' } });
    render(<GroupPageBreadcrumb groupId="group-1" title={title} />);
    expect(screen.getByText(title)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '群主页' }));
    expect(push).toHaveBeenCalledWith('/group/group-1');
    expect(useGroupWorkRequest.getState().request).toBeNull();
  });
});
