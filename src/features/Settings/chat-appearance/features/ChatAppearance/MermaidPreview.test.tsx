import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MermaidPreview from './MermaidPreview';

vi.mock('@lobehub/ui', () => ({
  Center: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Flexbox: ({
    children,
    ref,
    style,
  }: {
    children: React.ReactNode;
    ref?: React.Ref<HTMLDivElement>;
    style?: React.CSSProperties;
  }) => (
    <div data-testid="preview-frame" ref={ref} style={style}>
      {children}
    </div>
  ),
  Mermaid: ({ children }: { children: React.ReactNode }) => (
    <div>
      {children}
      <button data-testid="mermaid-action" type="button" />
    </div>
  ),
}));

describe('MermaidPreview', () => {
  it('contains the fixed-width diagram inside the mobile viewport', () => {
    render(<MermaidPreview />);

    expect(screen.getByTestId('preview-frame')).toHaveStyle({
      maxWidth: '100%',
      overflowX: 'auto',
    });
    expect(screen.getByTestId('mermaid-action')).toHaveAccessibleName('复制流程图代码');
  });
});
