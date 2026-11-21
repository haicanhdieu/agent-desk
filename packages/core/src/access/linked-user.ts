import { and, eq } from 'drizzle-orm';
import { account, type Tx } from '@agentdesk/db';

/**
 * The Agent Desk user signed in with this provider account (account.provider_id, account.account_id), or null.
 * An account linked to more than one user is ambiguous and also yields null (fail closed, as migration 0025 does).
 */
export async function findLinkedUser(tx: Tx, provider: string, externalId: string): Promise<string | null> {
  const rows = await tx
    .selectDistinct({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, provider), eq(account.accountId, externalId)))
    .limit(2);
  return rows.length === 1 ? (rows[0]?.userId ?? null) : null;
}
