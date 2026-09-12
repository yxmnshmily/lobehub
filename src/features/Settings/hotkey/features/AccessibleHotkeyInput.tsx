'use client';

import { HotkeyInput, type HotkeyInputProps } from '@lobehub/ui';
import { memo, useLayoutEffect, useRef } from 'react';

interface AccessibleHotkeyInputProps extends HotkeyInputProps {
  clearLabel: string;
  resetLabel: string;
}

const AccessibleHotkeyInput = memo<AccessibleHotkeyInputProps>(
  ({ clearLabel, resetLabel, texts, ...rest }) => {
    const rootRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        const label = button.querySelector('.lucide-x') ? clearLabel : resetLabel;
        button.setAttribute('aria-label', label);
      });
    });

    return (
      <div ref={rootRef} style={{ display: 'contents' }}>
        <HotkeyInput {...rest} texts={{ ...texts, clear: clearLabel, reset: resetLabel }} />
      </div>
    );
  },
);

AccessibleHotkeyInput.displayName = 'AccessibleHotkeyInput';

export default AccessibleHotkeyInput;
