import type { ComponentProps } from 'react';

import DesktopChatInput from './Desktop';
import MobileChatInput from './Mobile';

/** Shared visual surface; callers supply capability-gated actions and their authorized transport. */
export default function InputSurface({
  mobile,
  ...props
}: ComponentProps<typeof DesktopChatInput> & { mobile?: boolean }) {
  return mobile ? (
    <MobileChatInput
      inputBanner={props.inputBanner}
      leftContent={props.leftContent}
      sendAreaPrefix={props.sendAreaPrefix}
    />
  ) : (
    <DesktopChatInput borderRadius={12} {...props} />
  );
}
