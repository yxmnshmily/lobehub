import { createContext } from 'react';

// Opt-in at the group surface: private chats and standalone shared transcripts stay unchanged.
export const GroupChatPresentation = createContext(false);
