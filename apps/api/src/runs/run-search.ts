import { or, sql, type SQL } from 'drizzle-orm';
import { runs } from '@agentdesk/db';

/**
 * Free-text search of the Run list (`q`): the run's own identifying fields plus its ticket and the tickets it is
 * linked to. Everything is a bound parameter and a case-insensitive substring test (`strpos`, so `%` and `_` in the
 * text are plain characters). Prompts, args, output and ids are not searched.
 */

/** Ticket columns as SQL, so one predicate serves the run rows and the newest-snapshot-per-ref CTE. */
interface TicketColumns {
  ref: SQL;
  number: SQL;
  title: SQL;
  labels: SQL;
}

/** A number-only query (`42`, `#42`): matched exactly against numbers, never as text. Nine digits keeps it an int4. */
function numericQuery(q: string): number | undefined {
  const m = /^#?(\d{1,9})$/.exec(q);
  return m?.[1] === undefined ? undefined : Number(m[1]);
}

const contains = (column: SQL, q: string): SQL => sql`strpos(lower(${column}), lower(${q})) > 0`;

/** The ticket number, ticket reference, title and label names (numeric query: number and exact reference only). */
function ticketMatches(c: TicketColumns, q: string): SQL {
  const n = numericQuery(q);
  if (n !== undefined) return sql`(${c.number} = ${n} or ${c.ref} = ${String(n)})`;
  return sql`(${contains(c.title, q)} or ${contains(c.ref, q)} or exists (
    select 1 from jsonb_array_elements(${c.labels}) as label where ${contains(sql`label ->> 'name'`, q)}
  ))`;
}

/** The run's own run number, routing rule command (shown with a `/`) and triggering login. */
function runMatches(q: string): SQL {
  const n = numericQuery(q);
  if (n !== undefined) return sql`${runs.number} = ${n}`;
  const command = q.replace(/^\/+/, '');
  return or(
    command === '' ? undefined : contains(sql`${runs.command}`, command),
    contains(sql`${runs.triggeredBy}`, q),
  ) as SQL;
}

/**
 * Refs of the tickets whose newest snapshot matches, and of the tickets linked to them by the newest link of each
 * PR (as `linkedTickets` shows them): a PR hit adds its issues and their other PRs, an issue hit adds its PRs.
 *
 * Query plan (EXPLAIN ANALYZE, local Postgres, one project of 30,000 runs / 15,000 tickets, measured when this was
 * added): the CTEs run once per statement (the `in (...)` is an uncorrelated, hashed subquery), so the count and the
 * page statement each took roughly 25-125 ms; the page statement stops early once 25 rows match, while a query
 * matching nothing reads every run of the project. The cost is linear in the project's run count. No btree or GIN
 * index can serve `strpos(lower(..))`, so none is added: a trigram index needs the pg_trgm extension, which is a
 * human decision to take only if a real project outgrows this.
 */
function matchingGroupRefs(projectId: string, q: string): SQL {
  return sql`(
    with snap as (
      select distinct on (ticket_ref) ticket_ref, ticket_number, ticket_title, ticket_labels
      from runs
      where project_id = ${projectId}
      order by ticket_ref, queued_at desc, id desc
    ),
    hits as (
      select s.ticket_ref from snap s
      where ${ticketMatches(
        {
          ref: sql`s.ticket_ref`,
          number: sql`s.ticket_number`,
          title: sql`s.ticket_title`,
          labels: sql`s.ticket_labels`,
        },
        q,
      )}
    ),
    edges as (
      select n.ticket_ref as pr_ref, l.issue_ref
      from (
        select distinct on (ticket_ref) ticket_ref, linked_issue_refs
        from runs
        where project_id = ${projectId} and ticket_kind = 'pr' and cardinality(linked_issue_refs) > 0
        order by ticket_ref, queued_at desc, id desc
      ) n
      cross join lateral unnest(n.linked_issue_refs) as l(issue_ref)
    )
    select ticket_ref from hits
    union select issue_ref from edges where pr_ref in (select ticket_ref from hits)
    union select pr_ref from edges where issue_ref in (select ticket_ref from hits)
    union select sibling.pr_ref from edges mine join edges sibling on sibling.issue_ref = mine.issue_ref
      where mine.pr_ref in (select ticket_ref from hits)
  )`;
}

/** The `where` piece for a Run list `q` in one project, or undefined when `q` is empty. */
export function runSearchCondition(projectId: string, q: string | undefined): SQL | undefined {
  const text = q?.trim();
  if (text === undefined || text === '') return undefined;
  return or(
    runMatches(text),
    ticketMatches(
      {
        ref: sql`${runs.ticketRef}`,
        number: sql`${runs.ticketNumber}`,
        title: sql`${runs.ticketTitle}`,
        labels: sql`${runs.ticketLabels}`,
      },
      text,
    ),
    sql`${runs.ticketRef} in ${matchingGroupRefs(projectId, text)}`,
  );
}
