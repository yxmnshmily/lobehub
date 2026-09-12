'use client';

import { type AnchorHTMLAttributes, type MouseEvent, type Ref, use } from 'react';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  GroupProjectScopeContext,
  scopeProjectPath,
} from '@/features/Projects/Layout/GroupProjectScope';
import { GroupWorkScopeContext, scopeGroupWorkPath } from '@/features/SuperGroup/GroupWorkScope';

import { useWorkspaceAwareNavigate } from './useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from './workspaceAwarePath';
import type { WorkspaceLinkProps } from './WorkspaceLink';

const WorkspaceLink = ({ ref, to, escape, onClick, target, ...rest }: WorkspaceLinkProps) => {
  const activeSlug = useActiveWorkspaceSlug();
  const projectScope = use(GroupProjectScopeContext);
  const groupScope = use(GroupWorkScopeContext);
  const navigate = useWorkspaceAwareNavigate();
  const resolved = buildWorkspaceAwarePath(
    scopeGroupWorkPath(scopeProjectPath(to, projectScope), groupScope),
    activeSlug,
    {
      escape,
    },
  );

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (target && target !== '_self') return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    navigate(resolved, { escape: true });
  };

  return (
    <a
      href={resolved}
      ref={ref as Ref<HTMLAnchorElement>}
      target={target}
      onClick={handleClick}
      {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
    />
  );
};

WorkspaceLink.displayName = 'WorkspaceLink';

export default WorkspaceLink;
