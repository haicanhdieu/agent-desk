#!/usr/bin/env node
// Claude Code transcript adapter: turns Claude's JSONL session log into `agentdesk: transcript <base64>` lines
// (docs/adr/0027-agent-neutral-transcript-protocol.md). Plain ESM, no imports outside `node:*`.
// The log text is untrusted: it is only parsed as JSON and forwarded as data, never a shell or a path.
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
import { basename, dirname, join, resolve, sep } from 'node:path';
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
const USAGE_PREFIX = 'agentdesk: usage ';
const USAGE_BASE64_MAX = 1000;
const STATE_VERSION = 2;

/** @typedef {{ id: string; at?: string; kind: 'user' | 'agent' | 'tool' | 'notice'; text: string; tool?: string; truncated?: boolean }} WireEntry */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @typedef {{ id: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWriteLongTokens: number }} UsageWire */

/** @param {unknown} ts @returns {string | undefined} */
const toAt = (ts) => {
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};

/** @param {unknown} v @returns {string} */
const toolSummary = (v) => (typeof v === 'string' ? v : '');

/**
 * Claude log entry (one parsed JSONL line) to wire entries; unknown shapes give [].
 * @param {unknown} entry
 * @returns {WireEntry[]}
 */
export function mapEntry(entry) {
  if (!isRecord(entry) || typeof entry.uuid !== 'string' || entry.uuid === '') return [];
  const uuid = entry.uuid;
  const at = toAt(entry.timestamp);
  /** @param {number} n @param {Omit<WireEntry, 'id' | 'at'>} rest @returns {WireEntry} */
  const make = (n, rest) => ({ id: `${uuid}:${n}`, ...(at ? { at } : {}), ...rest });
  const message = isRecord(entry.message) ? entry.message : undefined;
  const content = message?.content;
  /** @param {unknown} blocks */
  const textOf = (blocks) =>
    Array.isArray(blocks)
      ? blocks
          .filter((b) => isRecord(b) && b.type === 'text' && typeof b.text === 'string')
          .map((b) => /** @type {string} */ (/** @type {Record<string, unknown>} */ (b).text))
          .join('\n')
      : '';

  if (entry.type === 'system') {
    return entry.subtype === 'compact_boundary' ? [make(0, { kind: 'notice', text: 'Conversation compacted' })] : [];
  }
  if (entry.type === 'user') {
    if (entry.isMeta === true || entry.isCompactSummary === true) return [];
    const text = typeof content === 'string' ? content : textOf(content);
    return text.trim() === '' ? [] : [make(0, { kind: 'user', text })];
  }
  if (entry.type === 'assistant') {
    if (!Array.isArray(content)) return [];
    if (entry.isApiErrorMessage === true) {
      const text = textOf(content);
      return text.trim() === '' ? [] : [make(0, { kind: 'notice', text })];
    }
    /** @type {WireEntry[]} */
    const result = [];
    content.forEach((block, n) => {
      if (!isRecord(block)) return;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        result.push(make(n, { kind: 'agent', text: block.text }));
      } else if (block.type === 'tool_use' && typeof block.name === 'string' && block.name !== '') {
        const input = isRecord(block.input) ? block.input : {};
        let text;
        if (block.name === 'Bash') text = toolSummary(input.command);
        else if (block.name === 'Edit' || block.name === 'Write' || block.name === 'Read') {
          text = toolSummary(input.file_path);
        } else text = JSON.stringify(input).slice(0, OTHER_TOOL_SUMMARY_MAX);
        result.push(make(n, { kind: 'tool', tool: block.name.slice(0, 64), text }));
      }
    });
    return result;
  }
  return [];
}

/** @param {unknown} v @returns {v is number} */
const isCount = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Claude assistant log entry to one agent-neutral usage record (disjoint buckets), or undefined when it has no usable
 * usage. Sidechain (subagent) entries count. Only the model id, the call id and integers are taken from the entry.
 * @param {unknown} entry
 * @returns {UsageWire | undefined}
 */
export function mapUsage(entry) {
  if (!isRecord(entry) || entry.type !== 'assistant') return undefined;
  const message = entry.message;
  if (!isRecord(message) || typeof message.id !== 'string' || message.id === '') return undefined;
  if (typeof message.model !== 'string' || message.model === '' || message.model === '<synthetic>') return undefined;
  const usage = message.usage;
  if (!isRecord(usage) || !isCount(usage.input_tokens) || !isCount(usage.output_tokens)) return undefined;
  const optional = (/** @type {unknown} */ v) => (isCount(v) ? v : 0);
  const split = isRecord(usage.cache_creation) ? usage.cache_creation : undefined;
  const requestId = typeof entry.requestId === 'string' && entry.requestId !== '' ? entry.requestId : undefined;
  return {
    id: requestId ? `${message.id}:${requestId}` : message.id,
    model: message.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: optional(usage.cache_read_input_tokens),
    cacheWriteTokens: split ? optional(split.ephemeral_5m_input_tokens) : optional(usage.cache_creation_input_tokens),
    cacheWriteLongTokens: split ? optional(split.ephemeral_1h_input_tokens) : 0,
  };
}

/**
 * One protocol line: `agentdesk: usage <base64(JSON)>`; undefined when the body is over 1000 chars.
 * @param {UsageWire} u
 * @returns {string | undefined}
 */
export function usageLine(u) {
  const body = Buffer.from(
    JSON.stringify({
      id: u.id,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      cacheWriteLongTokens: u.cacheWriteLongTokens,
    }),
    'utf8',
  ).toString('base64');
  return body.length > USAGE_BASE64_MAX ? undefined : `${USAGE_PREFIX}${body}`;
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
  const join_ = (/** @type {number} */ n) => points.slice(0, n).join('');
  if (encode(join_(count)).length > BASE64_MAX) {
    // Quote- and newline-heavy text grows when JSON-encoded: find the longest prefix that fits.
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (encode(join_(mid)).length <= BASE64_MAX) lo = mid;
      else hi = mid - 1;
    }
    count = lo;
  }
  return { text: join_(count), truncated: count < points.length };
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

/** Most usage lines kept for a retry when the output stays unwritable. */
const MAX_PENDING_USAGE = 500;

/** @param {string} stateDir @returns {{ files: Record<string, { offset: number }>; pending: string[] }} */
function readState(stateDir) {
  try {
    const parsed = JSON.parse(readFileSync(stateFileOf(stateDir), 'utf8'));
    const files = isRecord(parsed) && isRecord(parsed.files) ? parsed.files : {};
    // A state file from before usage lines has no version: every tracked file restarts at offset 0 once.
    const restart = !isRecord(parsed) || parsed.version !== STATE_VERSION;
    /** @type {Record<string, { offset: number }>} */
    const result = {};
    for (const [path, v] of Object.entries(files)) {
      result[path] = {
        offset: !restart && isRecord(v) && typeof v.offset === 'number' && v.offset >= 0 ? v.offset : 0,
      };
    }
    const pending =
      !restart && Array.isArray(parsed.pendingUsage)
        ? parsed.pendingUsage.filter((l) => typeof l === 'string' && /^agentdesk: usage [A-Za-z0-9+/=]+$/.test(l))
        : [];
    return { files: result, pending };
  } catch {
    return { files: {}, pending: [] };
  }
}

/**
 * The session's subagent logs: Claude Code writes sidechain calls to <session>/subagents/agent-*.jsonl, not to the
 * main file.
 * @param {string} path the main session file
 * @returns {string[]}
 */
function subagentFiles(path) {
  try {
    const dir = join(path.replace(/\.jsonl$/, ''), 'subagents');
    return readdirSync(dir)
      .filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl'))
      .map((n) => join(dir, n));
  } catch {
    return [];
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
    const { files, pending } = readState(stateDir);
    for (const p of paths) for (const q of [p, ...subagentFiles(p)]) files[q] ??= { offset: 0 };
    /** @type {Map<string, UsageWire>} */
    const usage = new Map();
    let written = 0;
    for (const [path, state] of Object.entries(files)) {
      try {
        const { lines, offset } = readNew(path, state.offset);
        const isSubagent = basename(dirname(path)) === 'subagents';
        /** @type {string[]} */
        const wire = [];
        for (const line of lines) {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }
          // Subagent files only feed usage; their prompts and replies are not the run's thread.
          if (!isSubagent) {
            for (const e of mapEntry(entry)) wire.push(wireLine(e));
          }
          const u = mapUsage(entry);
          // One line per id per pass: the row with the larger output wins (a streaming placeholder never beats the
          // final row, whatever the order); on a tie the later row wins.
          const seen = u ? usage.get(u.id) : undefined;
          if (u && (!seen || u.outputTokens >= seen.outputTokens)) usage.set(u.id, u);
        }
        if (wire.length > 0) appendFileSync(out, `${wire.join('\n')}\n`);
        written += wire.length;
        state.offset = offset;
      } catch {
        // A missing or unreadable file, or an unwritable output: its offset stays, so the next call retries.
      }
    }
    const usageLines = [...pending];
    for (const u of usage.values()) {
      const l = usageLine(u);
      if (l) usageLines.push(l);
    }
    /** @type {string[]} */
    let unsent = [];
    if (usageLines.length > 0) {
      try {
        appendFileSync(out, `${usageLines.join('\n')}\n`);
        written += usageLines.length;
      } catch {
        // An unwritable output: those rows' offsets have moved on, so keep their lines in the state file and
        // send them on the next pass (the store dedupes by id).
        unsent = usageLines.slice(-MAX_PENDING_USAGE);
      }
    }
    const tmp = `${stateFileOf(stateDir)}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: STATE_VERSION, files, pendingUsage: unsent }));
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

/** The newest *.jsonl of this repo directory's Claude project dir, or none. @param {string} home @returns {string[]} */
function newestSessionFile(home) {
  try {
    const dir = join(home, '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
    let best;
    let bestTime = -1;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const mtime = statSync(join(dir, name)).mtimeMs;
      if (mtime > bestTime) {
        best = join(dir, name);
        bestTime = mtime;
      }
    }
    return best ? [best] : [];
  } catch {
    return [];
  }
}

/** `flush`: sends every recorded path plus the newest session file. Never throws. */
function flush() {
  try {
    const { home, stateDir, out } = dirs(process.env);
    sendNew({ paths: newestSessionFile(home), stateDir, out, waitMs: FLUSH_WAIT_MS, staleMs: FLUSH_STALE_MS });
  } catch {
    // Best effort.
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'flush') flush();
  process.exit(0);
}
