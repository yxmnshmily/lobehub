import { type SSOProvider } from '@lobechat/types';

import { clearActiveScopeKey } from '@/libs/swr/useCacheScope';
import { type StoreSetter } from '@/store/types';

import { clearUserDisplaySnapshot } from '../../displaySnapshot';
import { type UserStore } from '../../store';

interface AuthProvidersData {
  hasPasswordAccount: boolean;
  providers: SSOProvider[];
}

const fetchAuthProvidersData = async (): Promise<AuthProvidersData> => {
  const { accountInfo, listAccounts } = await import('@/libs/better-auth/auth-client');
  const result = await listAccounts();
  if (result.error || !Array.isArray(result.data)) throw new Error('Linked accounts unavailable');
  const accounts = result.data;
  const hasPasswordAccount = accounts.some((account) => account.providerId === 'credential');
  const providers = await Promise.all(
    accounts
      .filter((account) => account.providerId !== 'credential')
      .map(async (account) => {
        // Provider profile metadata is optional; its failure must not hide a confirmed link.
        const info = await accountInfo({ query: { accountId: account.accountId } }).catch(
          () => null,
        );
        return {
          email: info?.data?.user?.email ?? undefined,
          provider: account.providerId,
          providerAccountId: account.accountId,
        };
      }),
  );
  return { hasPasswordAccount, providers };
};

type Setter = StoreSetter<UserStore>;
export const createAuthSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new UserAuthActionImpl(set, get, _api);

export class UserAuthActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fetchAuthProviders = async (): Promise<void> => {
    // Skip if already loaded
    if (this.#get().isLoadedAuthProviders) return;

    await this.refreshAuthProviders();
  };

  logout = async (options?: { redirectTo?: string }): Promise<void> => {
    const currentUrl = window.location.href;

    // Capture the owner before any async work. The store may be updated by a
    // concurrent session event before Better Auth confirms this sign-out.
    const signingOutUserId = this.#get().user?.id;

    // Clear the OIDC Provider session for the current browser *before*
    // destroying the better-auth session. This prevents a stale OIDC session
    // from silently issuing tokens for the old account after the user signs
    // in as someone else.
    try {
      await fetch('/oidc/clear-session', { method: 'POST' });
    } catch {
      // Best-effort: don't block sign-out if the cleanup request fails
    }

    const { signOut } = await import('@/libs/better-auth/auth-client');
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          // Drop the persisted active scope so the next boot doesn't hydrate the
          // signed-out user's cache (localStorage survives the reload below).
          clearActiveScopeKey();
          clearUserDisplaySnapshot(signingOutUserId);
          // Use window.location.href to trigger a full page reload
          // This ensures all client-side state (React, Zustand, cache) is cleared
          window.location.href =
            options?.redirectTo || `/signin?callbackUrl=${encodeURIComponent(currentUrl)}`;
        },
      },
    });
  };

  openLogin = async (reason?: 'sessionExpired'): Promise<void> => {
    // Skip if already on a login page (/signin, /signup)
    const pathname = location.pathname;
    if (pathname.startsWith('/signin') || pathname.startsWith('/signup')) {
      return;
    }

    const currentUrl = location.toString();
    const params = new URLSearchParams({ callbackUrl: currentUrl });
    if (reason) params.set('reason', reason);
    window.location.href = `/signin?${params.toString()}`;
  };

  refreshAuthProviders = async (): Promise<void> => {
    if (this.#get().isLoadingAuthProviders) return;
    this.#set({ isLoadingAuthProviders: true, authProvidersError: false });
    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      this.#set({ authProviders: providers, hasPasswordAccount, isLoadedAuthProviders: true });
    } catch {
      // Preserve confirmed links and allow retry; never turn a failed request into an empty success.
      this.#set({ authProvidersError: true, isLoadedAuthProviders: false });
    } finally {
      this.#set({ isLoadingAuthProviders: false });
    }
  };
}

export type UserAuthAction = Pick<UserAuthActionImpl, keyof UserAuthActionImpl>;
