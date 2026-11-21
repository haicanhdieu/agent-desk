import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { runs, type Tx } from '@agentdesk/db';
import { TicketKind, type LinkedTicketDto, type TicketDto } from '@agentdesk/contracts';

type RunRow = typeof runs.$inferSelect;

/** The newest run with a non-empty link of each PR: for the page's PR refs, and for PRs whose newest link
 *  overlaps the page's issue refs or the refs of the page PRs' newest links (one statement, CTE + distinct on). */
export interface NewestLink {
  ref: string;
  number: number;
  refs: string[];
}

/** Newest run snapshot per ref (distinct on (ticket_ref) … order by ticket_ref, queued_at desc, id desc). */
export interface TicketSnapshot {
  ref: string;
  kind: TicketKind;
  number: number;
  title: string;
  url: string;
  labels: TicketDto['labels'];
}

const LinkRows = z.array(
  z.object({
    ticket_ref: z.string(),
    ticket_number: z.number().int().nullable(),
    linked_issue_refs: z.array(z.string()),
  }),
);

/** A bound-parameter text[] (an empty list is a literal empty array, which `array[]` could not type). */
const textArray = (values: string[]): SQL =>
  values.length === 0
    ? sql`'{}'::text[]`
    : sql`array[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`;

export async function newestLinks(
  tx: Tx,
  projectId: string,
  pagePrRefs: string[],
  pageIssueRefs: string[],
): Promise<NewestLink[]> {
  if (pagePrRefs.length === 0 && pageIssueRefs.length === 0) return [];
  const prs = textArray(pagePrRefs);
  const result = await tx.execute(sql`
    with page_prs as (
      select distinct on (ticket_ref) ticket_ref, linked_issue_refs
      from runs
      where project_id = ${projectId} and ticket_kind = 'pr' and cardinality(linked_issue_refs) > 0
        and ticket_ref = any(${prs})
      order by ticket_ref, queued_at desc, id desc
    ),
    wanted as (
      select coalesce(array_agg(distinct r), '{}'::text[]) as refs
      from (
        select unnest(linked_issue_refs) as r from page_prs
        union
        select unnest(${textArray(pageIssueRefs)}) as r
      ) u
    ),
    candidates as (
      select distinct ticket_ref
      from runs
      where project_id = ${projectId} and ticket_kind = 'pr' and linked_issue_refs && (select refs from wanted)
    ),
    newest as (
      select distinct on (ticket_ref) ticket_ref, ticket_number, linked_issue_refs
      from runs
      where project_id = ${projectId} and ticket_kind = 'pr' and cardinality(linked_issue_refs) > 0
        and ticket_ref in (select ticket_ref from candidates)
      order by ticket_ref, queued_at desc, id desc
    )
    select ticket_ref, ticket_number, linked_issue_refs
    from newest
    where ticket_ref = any(${prs}) or linked_issue_refs && (select refs from wanted)
  `);
  return LinkRows.parse(result.rows).map((r) => ({
    ref: r.ticket_ref,
    number: r.ticket_number ?? 0,
    refs: r.linked_issue_refs,
  }));
}

export async function newestSnapshots(tx: Tx, projectId: string, refs: string[]): Promise<Map<string, TicketSnapshot>> {
  const out = new Map<string, TicketSnapshot>();
  const unique = [...new Set(refs)];
  if (unique.length === 0) return out;
  const found = await tx
    .selectDistinctOn([runs.ticketRef], {
      ref: runs.ticketRef,
      kind: runs.ticketKind,
      number: runs.ticketNumber,
      title: runs.ticketTitle,
      url: runs.ticketUrl,
      labels: runs.ticketLabels,
    })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.ticketRef, unique)))
    .orderBy(runs.ticketRef, desc(runs.queuedAt), desc(runs.id));
  for (const f of found) {
    out.set(f.ref, {
      ref: f.ref,
      kind: TicketKind.parse(f.kind),
      number: f.number ?? 0,
      title: f.title ?? '',
      url: f.url ?? '',
      labels: f.labels,
    });
  }
  return out;
}

/** Pure: each page row's linkedTickets by the contract rules (Global Constraints). Refs with count 0 or no
 *  snapshot are dropped; a ref whose snapshot kind is 'pr' is never a lead. */
export function assembleLinkedTickets(
  rows: Pick<RunRow, 'id' | 'ticketRef' | 'ticketKind' | 'linkedIssueRefs'>[],
  links: NewestLink[],
  counts: ReadonlyMap<string, number>,
  snapshots: ReadonlyMap<string, TicketSnapshot>,
): Map<string, LinkedTicketDto[]> {
  const entry = (ref: string): LinkedTicketDto | null => {
    const s = snapshots.get(ref);
    const n = counts.get(ref) ?? 0;
    if (!s || n < 1) return null;
    return {
      ref: s.ref,
      kind: s.kind,
      number: s.number,
      title: s.title,
      url: s.url,
      labels: s.labels,
      ticketRunCount: n,
    };
  };
  const present = (refs: string[]): LinkedTicketDto[] => refs.flatMap((r) => entry(r) ?? []);

  // The lead issue of each PR: the lowest-numbered issue with runs among its newest link's refs.
  const leadByPr = new Map<string, string>();
  const prsByLead = new Map<string, string[]>();
  for (const link of links) {
    const lead = link.refs
      .flatMap((r) => {
        const s = snapshots.get(r);
        return s && s.kind === 'issue' && (counts.get(r) ?? 0) > 0 ? [s] : [];
      })
      .sort((a, b) => a.number - b.number)[0];
    if (!lead || !entry(link.ref)) continue;
    leadByPr.set(link.ref, lead.ref);
    prsByLead.set(lead.ref, [...(prsByLead.get(lead.ref) ?? []), link.ref]);
  }
  for (const [lead, prRefs] of prsByLead) {
    prsByLead.set(
      lead,
      prRefs.sort((a, b) => (snapshots.get(a)?.number ?? 0) - (snapshots.get(b)?.number ?? 0)),
    );
  }

  const out = new Map<string, LinkedTicketDto[]>();
  for (const row of rows) {
    if (row.ticketKind === 'pr') {
      const lead = row.linkedIssueRefs.length > 0 ? leadByPr.get(row.ticketRef) : undefined;
      out.set(
        row.id,
        lead === undefined ? [] : present([lead, ...(prsByLead.get(lead) ?? []).filter((r) => r !== row.ticketRef)]),
      );
    } else {
      out.set(row.id, present(prsByLead.get(row.ticketRef) ?? []));
    }
  }
  return out;
}
