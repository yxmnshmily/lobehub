'use client';

import { type AnchorHTMLAttributes, type Ref, use } from 'react';
import { Link, type LinkProps } from 'react-router';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import {
  GroupProjectScopeContext,
  scopeProjectPath,
} from '@/features/Projects/Layout/GroupProjectScope';
import { GroupWorkScopeContext, scopeGroupWorkPath } from '@/features/SuperGroup/GroupWorkScope';

import { buildWorkspaceAwarePath } from './workspaceAwarePath';

export interface WorkspaceLinkProps extends Omit<LinkProps, 'to' | 'ref'> {
  /** When true, do not apply the workspace prefix. */
  escape?: boolean;
  /**
   * Widened to `HTMLElement` so existing sidebar callsites passing a
   * `useState<HTMLElement | null>` setter work without changes.
   */
  ref?: Ref<HTMLElement>;
  /** Same semantics as `<Link to>` but auto-prefixed with the active workspace slug. */
  to: string;
}

const WorkspaceLink = ({ ref, to, escape, ...rest }: WorkspaceLinkProps) => {
  const activeSlug = useActiveWorkspaceSlug();
  const projectScope = use(GroupProjectScopeContext);
  const groupScope = use(GroupWorkScopeContext);
  const target = buildWorkspaceAwarePath(
    scopeGroupWorkPath(scopeProjectPath(to, projectScope), groupScope),
    activeSlug,
    {
      escape,
    },
  );
  return (
    <Link
      ref={ref as Ref<HTMLAnchorElement>}
      to={target}
      {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
    />
  );
};

WorkspaceLink.displayName = 'WorkspaceLink';

export default WorkspaceLink;
