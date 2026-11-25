// OpenCode status plugin: maps the CLI's event stream to `agentdesk: state ...` protocol lines
// (docs/adr/0020, docs/superpowers/specs/2026-11-14-agent-run-status-design.md section 6.2). prepare.sh copies this file to
// $XDG_CONFIG_HOME/opencode/plugins/agentdesk-status.js, where OpenCode auto-loads it (spike.json, status): a default
// export { id, setup(ctx) }, with ctx.event.subscribe() returning an async iterable of { type, data } events.
// Mapping: execution.started -> working; permission.asked -> needs_input approval; permission.replied -> working;
// execution.succeeded|failed|interrupted -> the declared done / needs_input (agentdesk-status), else needs_input
// undeclared with the last text. Event text is untrusted: it is only used as data, never a shell. Plain ESM, node:* only.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// Twice the stored cap (AGENT_NOTE_MAX in contracts): the worker redacts the full text, then cuts to 500.
const NOTE_MAX = 1000;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// Same rules as toAgentNote in packages/contracts: one line, control chars to space, trimmed, capped.
/** @param {unknown} raw @returns {string} */
const toNote = (raw) =>
  typeof raw === 'string'
    ? raw
        .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
        .trim()
        .slice(0, NOTE_MAX)
    : '';
/** @param {unknown} raw @returns {string} */
const noteArg = (raw) => {
  const note = toNote(raw);
  return note ? Buffer.from(note, 'utf8').toString('base64') : '-';
};

/** @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env */
const paths = (env) => {
  const stateDir = env.AGENTDESK_STATE_DIR || '/home/runner/.agentdesk';
  return {
    stateDir,
    stateFile: join(stateDir, 'state.json'),
    out: env.AGENTDESK_STATUS_OUT || '/proc/1/fd/1',
    hookSeen: join(env.AGENTDESK_RUN_DIR || '/run/agentdesk', 'hook-seen'),
    transcript: join(env.AGENTDESK_LIB_DIR || '/usr/local/lib/agentdesk', 'agents', 'opencode', 'transcript.mjs'),
  };
};

/** @param {string} file @returns {Record<string, unknown>} */
const readState = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Handles the event stream until it ends. The first thing it does is create the per-pod hook-seen file, which tells the
 * entrypoint's startup check the agent started (the TUI emits no session event before the first prompt).
 * @param {AsyncIterable<unknown>} events
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {Promise<void>}
 */
export async function consume(events, env = process.env) {
  const p = paths(env);
  try {
    mkdirSync(join(p.hookSeen, '..'), { recursive: true });
    closeSync(openSync(p.hookSeen, 'a'));
  } catch {
    // The run dir is not writable: the startup check may then fire late, which is harmless.
  }
  /** @type {string | undefined} */
  let last;
  let lastText = '';
  /** @param {string} word @param {string} [rest] */
  const emit = (word, rest) => {
    appendFileSync(p.out, `agentdesk: state ${word}${rest ? ` ${rest}` : ''}\n`);
    last = word;
  };
  // Removes and returns the declaration of the finished turn (written by agentdesk-status).
  const takeDeclared = () => {
    const state = readState(p.stateFile);
    if (!('declared' in state)) return undefined;
    const { declared, ...rest } = state;
    mkdirSync(p.stateDir, { recursive: true });
    const tmp = `${p.stateFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rest));
    renameSync(tmp, p.stateFile);
    return declared;
  };
  const sendTranscript = () => {
    if (!existsSync(p.transcript)) return;
    try {
      // `node` from PATH: inside OpenCode, process.execPath is the CLI binary itself.
      spawn('node', [p.transcript, 'flush'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...env },
      }).unref();
    } catch {
      // Best effort: the entrypoint flushes again at the end.
    }
  };

  for await (const event of events) {
    try {
      if (!isRecord(event) || typeof event.type !== 'string') continue;
      const data = isRecord(event.data) ? event.data : {};
      switch (event.type) {
        case 'session.execution.started':
          takeDeclared();
          lastText = '';
          emit('working');
          break;
        case 'session.text.ended':
          if (typeof data.text === 'string') lastText = data.text;
          break;
        case 'permission.asked':
          if (last !== 'needs_input') {
            const resources = Array.isArray(data.resources) ? data.resources.filter((r) => typeof r === 'string') : [];
            emit('needs_input', `approval ${noteArg(resources[0] ?? data.action)}`);
          }
          break;
        case 'permission.replied':
          // Once, always or reject: the run goes on either way.
          if (last === 'needs_input') emit('working');
          break;
        case 'session.execution.succeeded':
        case 'session.execution.failed':
        case 'session.execution.interrupted': {
          const declared = takeDeclared();
          if (isRecord(declared) && (declared.state === 'done' || declared.state === 'needs_input')) {
            emit(declared.state, `declared ${noteArg(declared.summary)}`);
          } else {
            emit('needs_input', `undeclared ${noteArg(lastText)}`);
          }
          sendTranscript();
          break;
        }
        default:
          // Usage, steps, tool events and shutdown carry no status.
          break;
      }
    } catch {
      // One bad event never stops the stream.
    }
  }
}

export default {
  id: 'agentdesk-status',
  /** @param {{ event: { subscribe: (opts?: unknown) => AsyncIterable<unknown> } }} ctx */
  setup(ctx) {
    // Not awaited: the loop runs for the life of the CLI (spike.json, status.note).
    void consume(ctx.event.subscribe()).catch(() => undefined);
  },
};
