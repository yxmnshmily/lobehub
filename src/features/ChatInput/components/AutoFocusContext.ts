import { createContext } from 'react';

// Embedded composers must not scroll their host page on initial hydration.
export const ChatInputAutoFocusContext = createContext(true);
