import type { ReactNode } from 'react';

export const resolveActionAccessibleLabel = (ariaLabel: string | undefined, title: ReactNode) =>
  ariaLabel ?? (typeof title === 'string' ? title : undefined);
