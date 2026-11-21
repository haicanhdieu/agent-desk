import type { InviterDto } from '@agentdesk/contracts';

/**
 * The BR-52 fallback, the one place it lives: the inviter's trimmed display name, or their handle when that is blank.
 * No row (the inviter's user is gone) gives null.
 */
export function toInviterDto(row: { name: string; handle: string | null } | null | undefined): InviterDto | null {
  if (!row) return null;
  const handle = row.handle ?? '';
  const name = row.name.trim();
  return { name: name === '' ? handle : name, handle };
}
