import { type MermaidProps } from '@lobehub/ui';
import { Center, Flexbox, Mermaid } from '@lobehub/ui';
import { useLayoutEffect, useRef } from 'react';

const code = `sequenceDiagram
    Alice->>John: Hello John, how are you?
    John-->>Alice: Great!
    Alice-)John: See you later!
`;

const MermaidPreview = ({ theme }: { theme?: MermaidProps['theme'] }) => {
  const previewRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    previewRef.current
      ?.querySelectorAll('button:not([aria-label]):not([title])')
      .forEach((button) => button.setAttribute('aria-label', '复制流程图代码'));
  }, []);

  return (
    <Center>
      <Flexbox
        ref={previewRef}
        style={{ marginBlockStart: 20, maxWidth: '100%', overflowX: 'auto' }}
        width={480}
      >
        <Mermaid theme={theme} variant="borderless">
          {code}
        </Mermaid>
      </Flexbox>
    </Center>
  );
};

export default MermaidPreview;
