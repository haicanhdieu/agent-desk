import { slicePage, type Page, type PlatformAuditEntryDto, type PlatformAuditListQuery } from '@agentdesk/contracts';
import { platformAuditFixtures } from '../dto/platform';
import { mockDb } from './db';

let entries: PlatformAuditEntryDto[] = structuredClone(platformAuditFixtures);
mockDb.onReset(() => {
  entries = structuredClone(platformAuditFixtures);
});

/** Replaces the audit log (scenario seeding); a store reset puts the fixtures back. */
export function seedPlatformAudit(next: PlatformAuditEntryDto[]): void {
  entries = structuredClone(next);
}

/** Newest first, optionally narrowed by organization and action (as the API's list). */
export function listPlatformAudit(q: PlatformAuditListQuery): Page<PlatformAuditEntryDto> {
  const rows = entries
    .filter(
      (e) => (q.orgId === undefined || e.org?.id === q.orgId) && (q.action === undefined || e.action === q.action),
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  return slicePage(rows, q);
}
