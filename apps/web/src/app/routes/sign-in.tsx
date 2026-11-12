import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authClient } from '@/features/auth/client';
import { safeRedirect } from '@/features/auth/redirect';
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
  component: SignInPage,
});

function SignInPage() {
  const { redirect } = Route.useSearch();
  const href = Route.fullPath + (redirect === undefined ? '' : `?redirect=${encodeURIComponent(redirect)}`);
  // better-auth answers with the GitHub authorize URL and its redirect plugin moves the page there.
  const signIn = () => void authClient.signIn.social({ provider: 'github', callbackURL: redirect ?? '/' });
  return <SignIn signInHref={href} onSignIn={signIn} />;
}
