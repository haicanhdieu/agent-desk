#!/usr/bin/env node
// OpenCode transcript adapter: turns the CLI's session export (`opencode session export <id>`; the sessions live in the
// CLI's SQLite store, there is no log file to tail) into `agentdesk: transcript <base64>` lines
// (docs/adr/0027-agent-neutral-transcript-protocol.md). Plain ESM, no imports outside `node:*`. The export text is
// untrusted: it is only parsed as JSON and forwarded as data, never a shell or a path. Session ids reach argv only when
// they are plain ids. Writes go only under AGENTDESK_STATE_DIR and to the status output.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_MAX_BYTES = 8000;
const BASE64_MAX = 12000;
const TOOL_SUMMARY_MAX = 200;
const LOCK_STALE_MS = 30_000;
// The final flush waits briefly for a concurrent flush and reaps a lock left by a killed one sooner, all well inside the
// entrypoint's 5 s timeout. Resends are safe: the store dedupes by entry id.
const FLUSH_WAIT_MS = 1500;
const FLUSH_STALE_MS = 2000;
const WAIT_STEP_MS = 50;
// The whole listing + exports of one flush must fit the entrypoint's 5 s limit (it sends nothing if killed). A standalone
// call starts its own server from the ~270 MB binary: measured 0.15-0.4 s warm on linux-arm64 (CLI 2.4.1), so the budget
// leaves room for a cold start (plus the lock wait, still under the limit) and each call's timeout is whatever is left of it.
const CLI_BUDGET_MS = 3000;
const MAX_SESSIONS = 20;
const MAX_SENT_IDS = 5000;
const PREFIX = 'agentdesk: transcript ';
const STATE_VERSION = 1;
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** @typedef {{ id: string; at?: string; kind: 'user' | 'agent' | 'tool' | 'notice'; text: string; tool?: string; truncated?: boolean }} WireEntry */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} ms @returns {string | undefined} */
const toAt = (ms) => (typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined);

/** @param {string} id @returns {string} an entry id prefix: the characters an entry id may hold */
export const sessionPrefix = (id) => id.replace(/[^A-Za-z0-9._:-]/g, '-').slice(-64);

/**
 * The rows of one export: the messages of the whole-JSON `{ info, messages }` document the CLI prints (verified against
 * CLI 2.4.1). Anything else gives [].
 * @param {string} text
 * @returns {unknown[]}
 */
export function rowsOf(text) {
  try {
    const whole = JSON.parse(text);
    if (isRecord(whole) && Array.isArray(whole.messages)) return whole.messages;
  } catch {
    // Not JSON.
  }
  return [];
}

/** @param {unknown} part a tool part: { type: 'tool', id, name, state: { status, input, ... } } @returns {string} */
const toolText = (part) => {
  const input = isRecord(part) && isRecord(part.state) ? part.state.input : undefined;
  if (input === undefined) return '';
  if (isRecord(input) && typeof input.command === 'string') return input.command.slice(0, TOOL_SUMMARY_MAX);
  try {
    return (JSON.stringify(input) ?? '').slice(0, TOOL_SUMMARY_MAX);
  } catch {
    return '';
  }
};

/**
 * One export row to wire entries; unknown shapes give []. A user message is one row; an assistant message is sent once it
 * has completed: its text parts are one agent row, each tool part a tool row. Reasoning and idle markers are skipped.
 * @param {unknown} row
 * @param {string} sessionId
 * @returns {WireEntry[]}
 */
export function mapEntry(row, sessionId) {
  if (!isRecord(row) || typeof row.id !== 'string' || row.id === '') return [];
  const prefix = sessionPrefix(sessionId);
  const time = isRecord(row.time) ? row.time : {};
  const at = toAt(time.created);
  /** @param {string} suffix @param {Omit<WireEntry, 'id' | 'at'>} rest @returns {WireEntry} */
  const make = (suffix, rest) => ({ id: `${prefix}:${row.id}${suffix}`, ...(at ? { at } : {}), ...rest });

  if (row.type === 'user') {
    return typeof row.text === 'string' && row.text.trim() !== '' ? [make('', { kind: 'user', text: row.text })] : [];
  }
  if (row.type === 'assistant' && time.completed !== undefined && Array.isArray(row.content)) {
    const parts = row.content.filter(isRecord);
    const text = parts
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => /** @type {string} */ (p.text))
      .join('\n');
    /** @type {WireEntry[]} */
    const entries = text.trim() === '' ? [] : [make('', { kind: 'agent', text })];
    parts.forEach((p, i) => {
      if (p.type === 'tool' && typeof p.name === 'string' && p.name !== '') {
        entries.push(make(`:${i}`, { kind: 'tool', tool: p.name.slice(0, 64), text: toolText(p) }));
      }
    });
    return entries;
  }
  return [];
}

/**
 * Cuts text to at most 8000 UTF-8 bytes on a code point boundary, and so that `encode(text)` (the base64 body of the
 * whole line) is at most 12000 chars.
 * @param {string} text
 * @param {(text: string) => string} encode
 * @returns {{ text: string; truncated: boolean }}
 */
export function fitText(text, encode) {
  const points = Array.from(text);
  let bytes = 0;
  let count = 0;
  for (const p of points) {
    const size = Buffer.byteLength(p);
    if (bytes + size > TEXT_MAX_BYTES) break;
    bytes += size;
    count += 1;
  }
  const head = (/** @type {number} */ n) => points.slice(0, n).join('');
  if (encode(head(count)).length > BASE64_MAX) {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (encode(head(mid)).length <= BASE64_MAX) lo = mid;
      else hi = mid - 1;
    }
    count = lo;
  }
  return { text: head(count), truncated: count < points.length };
}

/** One protocol line: `agentdesk: transcript <base64(JSON)>`. @param {WireEntry} entry @returns {string} */
export function wireLine(entry) {
  // Measured with `truncated: true` so the final line, which may add it, cannot exceed the limit.
  const encode = (/** @type {string} */ t) =>
    Buffer.from(JSON.stringify({ ...entry, text: t, truncated: true }), 'utf8').toString('base64');
  const fit = fitText(entry.text, encode);
  const final = { ...entry, text: fit.text, ...(fit.truncated ? { truncated: true } : {}) };
  return `${PREFIX}${Buffer.from(JSON.stringify(final), 'utf8').toString('base64')}`;
}

/** @param {string} stateDir */
const stateFileOf = (stateDir) => join(stateDir, 'transcript.json');

/** @param {string} stateDir @returns {string[]} the entry ids already sent */
function readSent(stateDir) {
  try {
    const parsed = JSON.parse(readFileSync(stateFileOf(stateDir), 'utf8'));
    return isRecord(parsed) && parsed.version === STATE_VERSION && Array.isArray(parsed.sent)
      ? parsed.sent.filter((/** @type {unknown} */ s) => typeof s === 'string')
      : [];
  } catch {
    return [];
  }
}

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {string} lock @param {number} staleMs @returns {boolean} */
function tryAcquire(lock, staleMs) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      closeSync(openSync(lock, 'wx'));
      return true;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs <= staleMs) return false;
        unlinkSync(lock);
      } catch {
        // The holder released it, or it cannot be inspected: try once more, then give up.
      }
    }
  }
  return false;
}

/** @param {string} lock @param {number} waitMs @param {number} staleMs @returns {boolean} */
function acquire(lock, waitMs, staleMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (tryAcquire(lock, staleMs)) return true;
    if (Date.now() >= deadline) return false;
    sleep(WAIT_STEP_MS);
  }
}

/**
 * Sends the entries of the given exports that were not sent before; holds the lock; returns the number of lines written.
 * @param {{ exports: { id: string; text: string }[]; stateDir: string; out: string; waitMs?: number; staleMs?: number }} args
 * @returns {number}
 */
export function sendAll({ exports, stateDir, out, waitMs = 0, staleMs = LOCK_STALE_MS }) {
  mkdirSync(stateDir, { recursive: true });
  const lock = join(stateDir, 'transcript.lock');
  if (!acquire(lock, waitMs, staleMs)) return 0;
  try {
    const sent = readSent(stateDir);
    const known = new Set(sent);
    /** @type {string[]} */
    const wire = [];
    /** @type {string[]} */
    const fresh = [];
    for (const { id, text } of exports) {
      for (const row of rowsOf(text)) {
        for (const entry of mapEntry(row, id)) {
          if (known.has(entry.id)) continue;
          known.add(entry.id);
          fresh.push(entry.id);
          wire.push(wireLine(entry));
        }
      }
    }
    if (wire.length > 0) {
      appendFileSync(out, `${wire.join('\n')}\n`);
      const tmp = `${stateFileOf(stateDir)}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, sent: [...sent, ...fresh].slice(-MAX_SENT_IDS) }));
      renameSync(tmp, stateFileOf(stateDir));
    }
    return wire.length;
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // Already gone.
    }
  }
}

/** One session's export. @param {{ id: string; text: string; stateDir: string; out: string }} args @returns {number} */
export const sendExport = ({ id, text, stateDir, out }) => sendAll({ exports: [{ id, text }], stateDir, out });

/** @param {string[]} args @param {number} timeoutMs @returns {string} the CLI's stdout; throws on a failure or a timeout */
const cli = (args, timeoutMs) =>
  execFileSync('opencode', args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  });

/**
 * The plain ids of the CLI's session list: `session list --format json` prints an array of { id, updated, created,
 * projectId, directory } (verified against CLI 2.4.1), newest first.
 * @param {string} text
 * @returns {string[]}
 */
function sessionIds(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  /** @type {string[]} */
  const ids = [];
  for (const s of parsed) {
    if (isRecord(s) && typeof s.id === 'string' && PLAIN_ID.test(s.id)) ids.push(s.id);
  }
  return ids.slice(0, MAX_SESSIONS);
}

/**
 * Lists and exports the CLI's sessions within one time budget: each call gets what is left of it, and the exports stop
 * when it is spent. A session that cannot be exported does not hide the others; a failed list throws.
 * @param {{ run: (args: string[], timeoutMs: number) => string; budgetMs: number }} args
 * @returns {{ id: string; text: string }[]}
 */
export function collectExports({ run, budgetMs }) {
  const deadline = Date.now() + budgetMs;
  const left = () => Math.max(1, deadline - Date.now());
  /** @type {{ id: string; text: string }[]} */
  const exports = [];
  for (const id of sessionIds(run(['session', 'list', '--standalone', '--format', 'json'], left()))) {
    if (Date.now() >= deadline) break;
    try {
      exports.push({ id, text: run(['session', 'export', '--standalone', id], left()) });
    } catch {
      // One session that cannot be exported does not hide the others.
    }
  }
  return exports;
}

/** `flush`: exports the CLI's sessions and sends the new rows. Never throws. */
function flush() {
  try {
    const home = process.env.HOME || '/home/runner';
    const stateDir = process.env.AGENTDESK_STATE_DIR || join(home, '.agentdesk');
    const out = process.env.AGENTDESK_STATUS_OUT || '/proc/1/fd/1';
    const exports = collectExports({ run: cli, budgetMs: CLI_BUDGET_MS });
    sendAll({ exports, stateDir, out, waitMs: FLUSH_WAIT_MS, staleMs: FLUSH_STALE_MS });
  } catch {
    // Best effort.
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'flush') flush();
  process.exit(0);
}
