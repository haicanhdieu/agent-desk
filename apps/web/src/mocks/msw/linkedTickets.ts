import { RunDto, type LinkedTicketDto } from '@agentdesk/contracts';
import type { MockRun } from '../dto/runs';

/** The DTO without mock-only fields. */
export function toDto(run: MockRun): RunDto {
  // The schema drops keys it does not know, so linkedIssueRefs never reaches a response.
  return RunDto.parse(run);
}

const newestFirst = (a: MockRun, b: MockRun) => b.queuedAt.localeCompare(a.queuedAt) || b.id.localeCompare(a.id);

/** The API's linkedTickets rules over the project's mock runs (newest = queuedAt desc, id desc). */
export function linkedTicketsFor(run: MockRun, projectRuns: readonly MockRun[]): LinkedTicketDto[] {
  const byRef = new Map<string, MockRun[]>();
  for (const r of [...projectRuns].sort(newestFirst)) byRef.set(r.ticket.ref, [...(byRef.get(r.ticket.ref) ?? []), r]);
  const newest = (ref: string) => byRef.get(ref)?.[0];

  /** The lowest-numbered issue among the refs of the PR's newest linked run; a ref whose newest run is a PR never leads. */
  const leadOf = (prRef: string): string | undefined => {
    const linked = byRef.get(prRef)?.find((r) => (r.linkedIssueRefs ?? []).length > 0);
    const issues = (linked?.linkedIssueRefs ?? [])
      .map((ref) => newest(ref))
      .filter((r): r is MockRun => r !== undefined && r.ticket.kind === 'issue');
    return issues.sort((a, b) => a.ticket.number - b.ticket.number)[0]?.ticket.ref;
  };
  const prsLedBy = (issueRef: string): string[] =>
    [...byRef.keys()].filter((ref) => newest(ref)?.ticket.kind === 'pr' && leadOf(ref) === issueRef);

  let lead: string | undefined;
  let prRefs: string[];
  if (run.ticket.kind === 'pr') {
    lead = (run.linkedIssueRefs ?? []).length > 0 ? leadOf(run.ticket.ref) : undefined;
    prRefs = lead === undefined ? [] : prsLedBy(lead).filter((ref) => ref !== run.ticket.ref);
  } else {
    prRefs = prsLedBy(run.ticket.ref);
  }
  const prs = prRefs
    .flatMap((ref) => newest(ref) ?? [])
    .sort((a, b) => a.ticket.number - b.ticket.number)
    .map((r) => r.ticket.ref);
  return [...(lead === undefined ? [] : [lead]), ...prs].flatMap((ref): LinkedTicketDto[] => {
    const latest = newest(ref);
    if (!latest) return [];
    const { title, url, labels, kind, number } = latest.ticket;
    return [{ ref, kind, number, title, url, labels, ticketRunCount: byRef.get(ref)?.length ?? 0 }];
  });
}
