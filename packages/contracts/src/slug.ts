import { z } from 'zod';

export const ORG_SLUG_MAX = 63;
export const OrgSlug = z
  .string()
  .min(1)
  .max(ORG_SLUG_MAX)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

/** Derives a valid org slug from a display name; falls back to `org`. */
export function slugFromName(name: string): string {
  const trim = (s: string) => s.replace(/^-+|-+$/g, '');
  const slug = trim(
    trim(
      name
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-{2,}/g, '-'),
    ).slice(0, ORG_SLUG_MAX),
  );
  return slug === '' ? 'org' : slug;
}
