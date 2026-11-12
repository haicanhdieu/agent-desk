import { createFileRoute, redirect as redirectTo } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { authClient } from '@/features/auth/client';
import { safeRedirect } from '@/features/auth/redirect';
import { sessionQuery } from '@/features/auth/session';
import { SignIn } from '@/screens';

// `redirect` keeps only same-origin relative paths; anything else (absolute, protocol-relative, `/\host`) is dropped.
const SignInSearch = z.object({
  redirect: z
    .unknown()
    .transform((v) => safeRedirect(v))
    .optional(),
});

export const Route = createFileRoute('/sign-in')({
  // Always returns the key: match search merges over the root's raw params, so an omitted key would let the raw
  // `redirect` through.
  validateSearch: (search): { redirect?: string | undefined } => SignInSearch.parse(search),
  // Already signed in: on to the landing org (`/` redirects there). A failed session check shows the page.
  beforeLoad: async ({ context: { queryClient } }) => {
    const session = await queryClient.ensureQueryData(sessionQuery).catch(() => null);
    if (session) throw redirectTo({ to: '/' });
  },
  component: SignInPage,
});

function SignInPage() {
  const { redirect } = Route.useSearch();
  const href = Route.fullPath + (redirect === undefined ? '' : `?redirect=${encodeURIComponent(redirect)}`);
  const [failed, setFailed] = useState(false);
  // better-auth answers with the GitHub authorize URL and its redirect plugin moves the page there. A failure comes
  // back as `error` (or a thrown network error): shown, so the click is never silently lost.
  const signIn = () => {
    setFailed(false);
    authClient.signIn
      .social({ provider: 'github', callbackURL: redirect ?? '/' })
      .then((res) => setFailed(Boolean(res.error)))
      .catch(() => setFailed(true));
  };
  return <SignIn signInHref={href} onSignIn={signIn} error={failed ? 'Sign-in failed' : undefined} />;
}
