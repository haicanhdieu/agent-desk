import { and, eq, sql } from 'drizzle-orm';
import {
  TRANSCRIPT_ENTRY_CAP,
  TRANSCRIPT_LIMIT_NOTICE,
  type TranscriptKind,
  type TranscriptWireEntry,
} from '@agentdesk/contracts';
import { redact, unfinishedTokenStart } from '@agentdesk/core';
import { runs, runTranscriptEntries, withOrg, type Db, type Tx } from '@agentdesk/db';
import { appendSeqEvent } from './follow-core';

/** `source_id` of the single "limit reached" notice of a run. */
export const TRANSCRIPT_LIMIT_SOURCE_ID = 'agentdesk:limit';

const AT_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
const AT_MAX_AHEAD_MS = 5 * 60 * 1000;
const INSERT_ATTEMPTS = 3;
/** The adapter's cap on a summary of a tool outside `UNCAPPED_TOOLS`; one this long may have been cut, without `truncated`. */
const TOOL_SUMMARY_CAP = 200;
/**
 * Tools whose summary the adapter does not cap at 200 chars (only the 8000-byte cap, which sets `truncated`). Mirrors
 * images/runner/agents/claude/transcript.mjs (OTHER_TOOL_SUMMARY_MAX); the worker cannot import from images/.
 */
const UNCAPPED_TOOLS = new Set(['Bash', 'Edit', 'Write', 'Read']);

export interface TranscriptRow {
  sourceId: string;
  at: Date;
  kind: TranscriptKind;
  tool: string | null;
  text: string;
  truncated: boolean;
}

/** Start index of the longest tail of `text` that is a prefix of one of the known `secrets`, else the length. */
function secretFragmentStart(text: string, secrets: string[]): number {
  let start = text.length;
  for (const secret of secrets) {
    for (let k = Math.min(secret.length, text.length); k >= 1; k -= 1) {
      if (text.endsWith(secret.slice(0, k))) {
        start = Math.min(start, text.length - k);
        break;
      }
    }
  }
  return start;
}

/**
 * Removes the end of a text the adapter may have cut when that end could be the start of a secret: a prefix of a known
 * secret (even one char: the entry is already marked cut), or an unfinished token pattern (a secret straddling the cut
 * cannot match a redaction pattern). Any other text, including one long unbroken token, stays whole.
 */
function dropSecretTail(text: string, secrets: string[]): string {
  const start = Math.min(secretFragmentStart(text, secrets), unfinishedTokenStart(text));
  return start === text.length ? text : text.slice(0, start).trimEnd();
}

/**
 * Redacts, then (when the adapter may have cut the text) drops a trailing fragment that starts a secret, and replaces
 * NUL, which Postgres text rejects.
 */
function safeText(entry: TranscriptWireEntry, secrets: string[]): { text: string; cut: boolean } {
  let text = redact(entry.text, secrets);
  const maybeCut =
    entry.truncated === true ||
    (entry.kind === 'tool' && !UNCAPPED_TOOLS.has(entry.tool ?? '') && entry.text.length >= TOOL_SUMMARY_CAP);
  if (maybeCut) text = dropSecretTail(text, secrets);
  return { text: text.replaceAll('\u0000', '\uFFFD'), cut: maybeCut };
}

/**
 * Wire entry to row. The text is redacted with the run's secrets first (a tool step summary can hold one). `at` is the
 * adapter's time when plausible (now minus 31 days up to now plus 5 minutes), else `now`.
 */
export function toTranscriptRow(entry: TranscriptWireEntry, secrets: string[], now: Date): TranscriptRow {
  const parsed = entry.at === undefined ? Number.NaN : Date.parse(entry.at);
  const plausible =
    !Number.isNaN(parsed) && parsed >= now.getTime() - AT_MAX_AGE_MS && parsed <= now.getTime() + AT_MAX_AHEAD_MS;
  const { text, cut } = safeText(entry, secrets);
  return {
    sourceId: entry.id,
    at: plausible ? new Date(parsed) : now,
    kind: entry.kind,
    tool: entry.tool ?? null,
    text,
    truncated: entry.truncated === true || cut,
  };
}

/**
 * Inserts with the next per-run seq (the run row lock serialises appenders), ignoring a repeated `(run_id, source_id)`.
 * True when a row was inserted. Must run inside `withOrg`.
 */
export async function insertTranscriptEntry(
  tx: Tx,
  orgId: string,
  runId: string,
  row: TranscriptRow,
): Promise<boolean> {
  let inserted = false;
  await appendSeqEvent(tx, {
    lockOwner: async (t) =>
      (await t.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).for('update')).length > 0,
    maxSeq: async (t) => {
      const [max] = await t
        .select({ seq: sql<number>`coalesce(max(${runTranscriptEntries.seq}), 0)::int` })
        .from(runTranscriptEntries)
        .where(eq(runTranscriptEntries.runId, runId));
      return max?.seq ?? 0;
    },
    insert: async (t, seq) => {
      const done = await t
        .insert(runTranscriptEntries)
        .values({ orgId, runId, seq, ...row })
        .onConflictDoNothing()
        .returning({ seq: runTranscriptEntries.seq });
      inserted = done.length > 0;
    },
  });
  return inserted;
}

export async function countTranscriptEntries(tx: Tx, runId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(runTranscriptEntries)
    .where(eq(runTranscriptEntries.runId, runId));
  return row?.n ?? 0;
}

/**
 * One per follower attempt. Counts the run's stored rows once on first use (earlier pods' rows count), enforces the
 * per-run cap with one limit notice, and retries a failing insert; an entry that still fails is logged by kind and
 * count only (never its text) and the follower carries on.
 */
export function createTranscriptSink(deps: {
  db: Db;
  orgId: string;
  runId: string;
  now(): Date;
  warn(msg: string, fields: Record<string, unknown>): void;
}): { store(entry: TranscriptWireEntry, secrets: string[]): Promise<void> } {
  let stored: number | undefined;
  let capped = false;
  let failed = 0;

  const storeOnce = async (entry: TranscriptWireEntry, secrets: string[]): Promise<void> => {
    await withOrg(deps.db, deps.orgId, async (tx) => {
      stored ??= await countTranscriptEntries(tx, deps.runId);
      if (stored >= TRANSCRIPT_ENTRY_CAP) {
        // A resumed pod re-sends entries that are already stored: nothing was dropped, so no notice.
        const [known] = await tx
          .select({ seq: runTranscriptEntries.seq })
          .from(runTranscriptEntries)
          .where(and(eq(runTranscriptEntries.runId, deps.runId), eq(runTranscriptEntries.sourceId, entry.id)))
          .limit(1);
        if (known) return;
        // Idempotent on its source id: an earlier pod may already have stored it.
        const notice: TranscriptRow = {
          sourceId: TRANSCRIPT_LIMIT_SOURCE_ID,
          at: deps.now(),
          kind: 'notice',
          tool: null,
          text: TRANSCRIPT_LIMIT_NOTICE,
          truncated: false,
        };
        await insertTranscriptEntry(tx, deps.orgId, deps.runId, notice);
        capped = true;
        return;
      }
      if (await insertTranscriptEntry(tx, deps.orgId, deps.runId, toTranscriptRow(entry, secrets, deps.now()))) {
        stored += 1;
      }
    });
  };

  return {
    async store(entry, secrets) {
      if (capped) return;
      for (let attempt = 1; attempt <= INSERT_ATTEMPTS; attempt += 1) {
        try {
          await storeOnce(entry, secrets);
          return;
        } catch {
          // Retry; the error is dropped on purpose, it can carry the entry's text.
        }
      }
      failed += 1;
      deps.warn('transcript entry not stored', { kind: entry.kind, failed });
    },
  };
}
