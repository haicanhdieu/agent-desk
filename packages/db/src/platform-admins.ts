import type { Db } from './client';

/** Adds `email` (trimmed, lowercased) to platform_admins; a second call for the same email changes nothing. */
export async function seedPlatformAdmin(db: Db, email: string): Promise<void> {
  await db.pool.query('insert into platform_admins (email) values ($1) on conflict (email) do nothing', [
    email.trim().toLowerCase(),
  ]);
}
