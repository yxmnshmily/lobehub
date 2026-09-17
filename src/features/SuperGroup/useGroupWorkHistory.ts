import { useSearchParams } from 'react-router';

/** Keep the landing/list choice in the URL so detail-page Back restores the list. */
export function useGroupWorkHistory(groupId?: string) {
  const [params, setParams] = useSearchParams();
  const isHome = !!groupId && params.get('view') !== 'history';
  const toggleView = () => {
    if (!groupId) return;
    const next = new URLSearchParams(params);
    if (isHome) next.set('view', 'history');
    else next.delete('view');
    setParams(next);
  };
  return { isHome, toggleView };
}
