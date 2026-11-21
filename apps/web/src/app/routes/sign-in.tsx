import { NO_INVITATION_CODE } from '@agentdesk/contracts';
import { createFileRoute, redirect as redirectTo } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { authClient } from '@/features/auth/client';
import { safeRedirect } from '@/features/auth/redirect';
import { sessionQuery } from '@/features/auth/session';
import { SignIn, SignInNoInvitationError } from '@/screens';

// `redirect` keeps only same-origin relative paths; anything else (absolute, protocol-relative, `/\host`) is dropped.
// `error` (the refusal better-auth redirects with) keeps only whether it is the no-invitation code: any other value
// is `'other'`, so the value itself is never rendered.
const SignInSearch = z.object({
  redirect: z
    .unknown()
    .transform((v) => safeRedirect(v))
    .optional(),
  error: z
    .unknown()
    .transform((v): 'no_invitation' | 'other' => (v === NO_INVITATION_CODE ? NO_INVITATION_CODE : 'other'))
    .optional(),
});

export const Route = createFileRoute('/sign-in')({
  // Always returns the keys: match search merges over the root's raw params, so an omitted key would let the raw
  // `redirect` or `error` through.
  validateSearch: (search): { redirect?: string | undefined; error?: 'no_invitation' | 'other' | undefined } =>
    SignInSearch.parse(search),
  // Already signed in: on to the landing org (`/` redirects there). A failed session check shows the page.
  beforeLoad: async ({ context: { queryClient } }) => {
    const session = await queryClient.ensureQueryData(sessionQuery).catch(() => null);
    if (session) throw redirectTo({ to: '/' });
  },
  component: SignInPage,
});

function SignInPage() {
  const { redirect, error } = Route.useSearch();
  const href = Route.fullPath + (redirect === undefined ? '' : `?redirect=${encodeURIComponent(redirect)}`);
  const [failed, setFailed] = useState(false);
  // better-auth answers with the GitHub authorize URL and its redirect plugin moves the page there. A failure comes
  // back as `error` (or a thrown network error): shown, so the click is never silently lost. A refusal after the
  // GitHub round trip comes back to this page as `?error=…` (`errorCallbackURL`), keeping `redirect`.
  const signIn = () => {
    setFailed(false);
    authClient.signIn
      .social({ provider: 'github', callbackURL: redirect ?? '/', errorCallbackURL: href })
      .then((res) => setFailed(Boolean(res.error)))
      .catch(() => setFailed(true));
  };
  const shown =
    failed || error === 'other' ? (
      'Sign-in failed'
    ) : error === NO_INVITATION_CODE ? (
      <SignInNoInvitationError />
    ) : undefined;
  return <SignIn signInHref={href} onSignIn={signIn} error={shown} />;
}
