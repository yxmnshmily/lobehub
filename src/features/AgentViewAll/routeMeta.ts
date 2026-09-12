import { BotIcon } from 'lucide-react';

import MembersSkeleton from '@/components/Skeleton/Members';
import { routeMeta } from '@/spa/router/routeMeta';

export const agentsRouteMeta = routeMeta({
  icon: BotIcon,
  Skeleton: MembersSkeleton,
  titleKey: 'navigation.agents',
});
