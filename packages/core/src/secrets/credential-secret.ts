import { z } from 'zod';
import { CredentialType } from '@agentdesk/contracts';

/**
 * The payload of an agent's credential Secret. `baseUrl` is the API address the credential was saved for; absent means
 * the provider's own address (so Secrets saved before addresses existed keep working with a default-address agent).
 */
const CredentialSecretShape = z.object({
  type: CredentialType,
  value: z.string().min(1),
  baseUrl: z.string().nullish(),
});

export interface CredentialSecret {
  type: CredentialType;
  value: string;
  baseUrl: string | null;
}

/** The Secret data to store (string values only: a default address leaves `baseUrl` out). */
export function credentialSecretData(
  type: CredentialType,
  value: string,
  baseUrl: string | null,
): Record<string, string> {
  return baseUrl ? { type, value, baseUrl } : { type, value };
}

/** The usable credential in `data`, or null when the Secret is missing or malformed. */
export function parseCredentialSecret(data: Record<string, string> | null): CredentialSecret | null {
  const parsed = CredentialSecretShape.safeParse(data);
  if (!parsed.success) return null;
  return { type: parsed.data.type, value: parsed.data.value, baseUrl: parsed.data.baseUrl || null };
}

/**
 * True when a credential saved for `secret.baseUrl` may be used with an agent whose address is `agentBaseUrl`.
 * The one rule for the model list, the run launch and anywhere else a stored credential authenticates: null,
 * undefined and '' are the default address; any other address must be equal as stored (the contract trims and
 * validates it before it is saved).
 */
export function credentialMatchesAddress(
  secret: { baseUrl?: string | null },
  agentBaseUrl: string | null | undefined,
): boolean {
  return (secret.baseUrl || null) === (agentBaseUrl || null);
}
