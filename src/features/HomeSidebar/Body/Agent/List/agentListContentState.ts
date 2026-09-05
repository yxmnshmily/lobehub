export type AgentListContentState = 'error' | 'inbox' | 'loading' | 'ready';

interface ResolveAgentListContentStateParams {
  authLoaded: boolean;
  hasError?: boolean;
  isInit: boolean;
  isLogin: boolean;
}

export const resolveAgentListContentState = ({
  authLoaded,
  hasError,
  isInit,
  isLogin,
}: ResolveAgentListContentStateParams): AgentListContentState => {
  if (isInit) return 'ready';
  if (authLoaded && !isLogin) return 'inbox';
  if (authLoaded && isLogin && hasError) return 'error';
  return 'loading';
};
