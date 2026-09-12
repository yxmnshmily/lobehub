import { type PropsWithChildren, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import Loading from '@/components/Loading/BrandTextLoading';
import { resolveAuthCallbackPath } from '@/features/Auth/utils/mountedPath';
import { useSession } from '@/libs/better-auth/auth-client';

/** Check entry only: once a guest starts a form, its own success/onboarding flow owns navigation. */
export default function AuthSessionEntry({ children }: PropsWithChildren) {
  const { data: session, isPending } = useSession();
  const [searchParams] = useSearchParams();
  const [guestEntered, setGuestEntered] = useState(false);

  useEffect(() => {
    if (guestEntered || isPending) return;
    if (!session?.user) {
      setGuestEntered(true);
      return;
    }

    const fallback = resolveAuthCallbackPath(null);
    let destination = fallback;
    try {
      const target = new URL(
        resolveAuthCallbackPath(searchParams.get('callbackUrl')),
        window.location.origin,
      );
      const path = decodeURIComponent(target.pathname);
      if (
        target.origin === window.location.origin &&
        !target.pathname.startsWith('//') &&
        !/^(?:\/lobehub)?\/(?:signin|signup)(?:\/|$)/i.test(path)
      ) {
        destination = target.pathname + target.search + target.hash;
      }
    } catch {
      // Malformed and self-referencing callbacks return to the default group.
    }
    // Auth and the main app have separate routers; a document navigation crosses that boundary.
    window.location.replace(destination);
  }, [guestEntered, isPending, session?.user, searchParams]);

  return guestEntered ? children : <Loading debugId="AuthSessionEntry" />;
}
