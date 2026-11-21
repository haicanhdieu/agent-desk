import type { Config } from '../config/config.module';

/**
 * A platform admin is a session user whose verified email is listed in PLATFORM_ADMIN_EMAILS. Checked on every request,
 * so removing an email from config revokes the next call. The list is already trimmed and lowercased by the config.
 */
export function isPlatformAdmin(
  config: Pick<Config, 'PLATFORM_ADMIN_EMAILS'>,
  user: { email: string; emailVerified: boolean },
): boolean {
  if (!user.emailVerified) return false;
  return config.PLATFORM_ADMIN_EMAILS.includes(user.email.trim().toLowerCase());
}
