import { PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';

/**
 * True for the 409 the API answers when the user's GitHub token is rejected or cannot be refreshed. Retrying cannot
 * help: the person has to sign in with GitHub again. The type may carry a problem namespace prefix.
 */
export function isProviderReauthRequired(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    (e.type === PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE || e.type.endsWith(`:${PROVIDER_REAUTH_REQUIRED_PROBLEM_TYPE}`))
  );
}
