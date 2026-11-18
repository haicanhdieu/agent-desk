import type { CodeHostAdapter } from './adapters/types';

export interface RunAuthor {
  name: string;
  email: string;
  authorizedBy: string;
}

// The identity ends up as env values and git arguments in the run pod. The adapter validates the provider's own
// syntax; this guard is the floor for an adapter that forgets: no whitespace, no control characters, no leading dash.
const hasUnsafeChar = (v: string): boolean => {
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    // Space and below are whitespace or control characters; 0x7f is DEL. Unicode whitespace is checked below.
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return /\s/.test(v);
};
const isSafeValue = (v: string): boolean => v.length > 0 && !v.startsWith('-') && !hasUnsafeChar(v);

/**
 * The identity a run's commits carry and the name its PR says authorized it. The trigger person when there is one
 * (a recorded login that is not the bot, with a provider user id, that the code host accepts); otherwise the bot, so
 * nobody is credited who did not authorize the run. The login is untrusted text, so anything the adapter refuses or
 * that fails the generic guard falls back to the bot too.
 */
export function resolveRunAuthor(
  run: { triggeredBy: string | null; triggeredByExternalId: string | null },
  bot: { name: string; email: string },
  codeHost: Pick<CodeHostAdapter, 'commitIdentity'>,
): RunAuthor {
  const fallback: RunAuthor = { ...bot, authorizedBy: bot.name };
  const { triggeredBy, triggeredByExternalId } = run;
  if (triggeredBy === null || triggeredBy === bot.name || triggeredByExternalId === null) return fallback;
  const identity = codeHost.commitIdentity({ login: triggeredBy, externalId: triggeredByExternalId });
  if (identity === null || !isSafeValue(identity.name) || !isSafeValue(identity.email)) return fallback;
  return { name: identity.name, email: identity.email, authorizedBy: triggeredBy };
}
