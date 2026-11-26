#!/usr/bin/env node
// Codex transcript adapter: turns Codex's JSONL session log (rollout-*.jsonl under $CODEX_HOME/sessions) into
// `agentdesk: transcript <base64>` lines (docs/adr/0027-agent-neutral-transcript-protocol.md). Plain ESM, no imports
// outside `node:*`. The log text is untrusted: it is only parsed as JSON and forwarded as data, never a shell or a path.
// Writes go only under AGENTDESK_STATE_DIR and to the status output.
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_MAX_BYTES = 8000;
const BASE64_MAX = 12000;
const OTHER_TOOL_SUMMARY_MAX = 200;
const LOCK_STALE_MS = 30_000;
// The final flush runs after the last hook: it waits briefly for a hook holding the lock and reaps a lock left by a
// killed hook sooner, all well inside the entrypoint's 5 s timeout. Resends are safe: the store dedupes by entry id.
const FLUSH_WAIT_MS = 2500;
const FLUSH_STALE_MS = 2000;
const WAIT_STEP_MS = 50;
const PREFIX = 'agentdesk: transcript ';
const STATE_VERSION = 1;

/** @typedef {{ id: string; at?: string; kind: 'user' | 'agent' | 'tool' | 'notice'; text: string; tool?: string; truncated?: boolean }} WireEntry */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} ts @returns {string | undefined} */
const toAt = (ts) => {
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};

/**
 * The id prefix of a session file: its session id (the uuid at the end of the file name), reduced to the characters an
 * entry id may hold.
 * @param {string} path
 * @returns {string}
 */
export const sessionPrefix = (path) => {
  const name = basename(path).replace(/\.jsonl$/, '');
  const uuid = /[0-9A-Za-z]{8}(?:-[0-9A-Za-z]{4}){3}-[0-9A-Za-z]{12}$/.exec(name);
  return (uuid ? uuid[0] : name).replace(/[^A-Za-z0-9._:-]/g, '-').slice(-64);
};

/** @param {unknown} blocks @param {string} type @returns {string} */
const textOf = (blocks, type) =>
  Array.isArray(blocks)
    ? blocks
        .filter(
          (b) =>
            isRecord(b) && typeof b.type === 'string' && b.type.toLowerCase() === type && typeof b.text === 'string',
        )
        .map((b) => /** @type {string} */ (/** @type {Record<string, unknown>} */ (b).text))
        .join('\n')
    : '';

/** @param {unknown} command a shell command as an argv array or a string @returns {string} */
const commandText = (command) =>
  Array.isArray(command)
    ? command.filter((c) => typeof c === 'string').join(' ')
    : typeof command === 'string'
      ? command
      : '';

/**
 * Codex log row (one parsed JSONL line) to wire entries; unknown shapes give []. The conversation text comes from the
 * event_msg item_completed rows (the response_item message rows repeat it and also carry instructions, so they are
 * skipped); tool calls come from response_item rows.
 * @param {unknown} row
 * @param {string} prefix id prefix of the session file
 * @returns {WireEntry[]}
 */
export function mapEntry(row, prefix) {
  if (!isRecord(row) || !isRecord(row.payload) || !Number.isInteger(row.ordinal)) return [];
  const payload = row.payload;
  const at = toAt(row.timestamp);
  /** @param {Omit<WireEntry, 'id' | 'at'>} rest @returns {WireEntry[]} */
  const make = (rest) => [{ id: `${prefix}:${row.ordinal}`, ...(at ? { at } : {}), ...rest }];

  if (row.type === 'event_msg' && payload.type === 'item_completed' && isRecord(payload.item)) {
    const item = payload.item;
    const text = textOf(item.content, 'text');
    if (text.trim() === '') return [];
    if (item.type === 'UserMessage') return make({ kind: 'user', text });
    if (item.type === 'AgentMessage') return make({ kind: 'agent', text });
    return [];
  }
  if (row.type === 'response_item') {
    if (payload.type === 'local_shell_call') {
      const action = isRecord(payload.action) ? payload.action : {};
      return make({ kind: 'tool', tool: 'shell', text: commandText(action.command) });
    }
    if (
      (payload.type === 'function_call' || payload.type === 'custom_tool_call') &&
      typeof payload.name === 'string' &&
      payload.name !== ''
    ) {
      const raw =
        typeof payload.arguments === 'string'
          ? payload.arguments
          : typeof payload.input === 'string'
            ? payload.input
            : '';
      let text = raw.slice(0, OTHER_TOOL_SUMMARY_MAX);
      if (payload.name === 'shell' || payload.name === 'exec_command') {
        try {
          const args = JSON.parse(raw);
          if (isRecord(args)) text = commandText(args.command ?? args.cmd) || text;
        } catch {
          // Not JSON: the raw text stays as the summary.
        }
      }
      return make({ kind: 'tool', tool: payload.name.slice(0, 64), text });
    }
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
    // Quote- and newline-heavy text grows when JSON-encoded: find the longest prefix that fits.
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

/**
 * One protocol line: `agentdesk: transcript <base64(JSON)>`.
 * @param {WireEntry} entry
 * @returns {string}
 */
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

/** @param {string} stateDir @returns {Record<string, { offset: number }>} */
function readState(stateDir) {
  try {
    const parsed = JSON.parse(readFileSync(stateFileOf(stateDir), 'utf8'));
    const files = isRecord(parsed) && parsed.version === STATE_VERSION && isRecord(parsed.files) ? parsed.files : {};
    /** @type {Record<string, { offset: number }>} */
    const result = {};
    for (const [path, v] of Object.entries(files)) {
      result[path] = { offset: isRecord(v) && typeof v.offset === 'number' && v.offset >= 0 ? v.offset : 0 };
    }
    return result;
  } catch {
    return {};
  }
}

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * @param {string} lock
 * @param {number} waitMs how long to keep trying while a fresh lock is held
 * @param {number} staleMs age after which a lock is taken over
 * @returns {boolean} true when the lock is held by the caller
 */
function acquire(lock, waitMs, staleMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (tryAcquire(lock, staleMs)) return true;
    if (Date.now() >= deadline) return false;
    sleep(WAIT_STEP_MS);
  }
}

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

/**
 * Reads the complete new lines of one file from `offset`.
 * @param {string} path
 * @param {number} offset
 * @returns {{ lines: string[]; offset: number }}
 */
function readNew(path, offset) {
  const size = statSync(path).size;
  const from = offset > size ? 0 : offset; // a replaced, shorter file starts over
  const length = size - from;
  if (length === 0) return { lines: [], offset: from };
  const buf = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, length, from);
  } finally {
    closeSync(fd);
  }
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return { lines: [], offset: from };
  return { lines: buf.subarray(0, end).toString('utf8').split('\n'), offset: from + end + 1 };
}

/**
 * Sends entries appended since the saved offset of each path; holds the lock; returns the number of lines written.
 * @param {{ paths: string[]; stateDir: string; out: string; waitMs?: number; staleMs?: number }} args
 * @returns {number}
 */
export function sendNew({ paths, stateDir, out, waitMs = 0, staleMs = LOCK_STALE_MS }) {
  mkdirSync(stateDir, { recursive: true });
  const lock = join(stateDir, 'transcript.lock');
  if (!acquire(lock, waitMs, staleMs)) return 0;
  try {
    const files = readState(stateDir);
    for (const p of paths) files[p] ??= { offset: 0 };
    let written = 0;
    for (const [path, state] of Object.entries(files)) {
      try {
        const { lines, offset } = readNew(path, state.offset);
        const prefix = sessionPrefix(path);
        /** @type {string[]} */
        const wire = [];
        for (const line of lines) {
          let row;
          try {
            row = JSON.parse(line);
          } catch {
            continue;
          }
          for (const e of mapEntry(row, prefix)) wire.push(wireLine(e));
        }
        if (wire.length > 0) appendFileSync(out, `${wire.join('\n')}\n`);
        written += wire.length;
        state.offset = offset;
      } catch {
        // A missing or unreadable file, or an unwritable output: its offset stays, so the next call retries.
      }
    }
    const tmp = `${stateFileOf(stateDir)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, files }));
    renameSync(tmp, stateFileOf(stateDir));
    return written;
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // Already gone.
    }
  }
}

/** @param {NodeJS.ProcessEnv} env */
const dirs = (env) => {
  const home = env.HOME || '/home/runner';
  return {
    home,
    codexHome: env.CODEX_HOME || join(home, '.codex'),
    stateDir: env.AGENTDESK_STATE_DIR || join(home, '.agentdesk'),
    out: env.AGENTDESK_STATUS_OUT || '/proc/1/fd/1',
  };
};

/**
 * Hook entry point: records input.transcript_path (a string under $HOME) and sends; never throws.
 * @param {unknown} input
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
export function transcriptStep(input, env = process.env) {
  try {
    if (!isRecord(input) || typeof input.transcript_path !== 'string') return;
    const { home, stateDir, out } = dirs(env);
    const path = resolve(input.transcript_path);
    if (!path.startsWith(resolve(home) + sep)) return;
    sendNew({ paths: [path], stateDir, out });
  } catch {
    // The transcript step never changes the hook's result.
  }
}

/** The newest rollout-*.jsonl under $CODEX_HOME/sessions (year/month/day folders), or none. @param {string} codexHome @returns {string[]} */
function newestSessionFile(codexHome) {
  /** @type {string | undefined} */
  let best;
  let bestTime = -1;
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of names) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        const mtime = statSync(full).mtimeMs;
        if (mtime > bestTime) {
          best = full;
          bestTime = mtime;
        }
      }
    }
  };
  walk(join(codexHome, 'sessions'), 0);
  return best ? [best] : [];
}

/** `flush`: sends every recorded path plus the newest session file. Never throws. */
function flush() {
  try {
    const { codexHome, stateDir, out } = dirs(process.env);
    sendNew({ paths: newestSessionFile(codexHome), stateDir, out, waitMs: FLUSH_WAIT_MS, staleMs: FLUSH_STALE_MS });
  } catch {
    // Best effort.
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'flush') flush();
  process.exit(0);
}
