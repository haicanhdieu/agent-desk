import { platformAdmins, type Db } from '@agentdesk/db';
import { eq } from 'drizzle-orm';

/**
 * A platform admin is a session user whose verified email has a `platform_admins` entry. Checked on every request, so
 * deleting the entry revokes the next call. False for an unverified session email; a database error rejects, so the
 * callers fail closed.
 */
export async function isPlatformAdmin(db: Db, user: { email: string; emailVerified: boolean }): Promise<boolean> {
  if (!user.emailVerified) return false;
  const rows = await db.orm
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, user.email.trim().toLowerCase()))
    .limit(1);
  return rows.length > 0;
}
