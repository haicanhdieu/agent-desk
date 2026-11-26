#!/usr/bin/env node
// Codex adapter: maps hook events to `agentdesk: state ...` protocol lines
// (docs/superpowers/specs/2026-11-14-agent-run-status-design.md section 6.2).
// Hook input is untrusted text and is only ever used as data (never a shell).
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
import { transcriptStep } from './transcript.mjs';

// Twice the stored cap (AGENT_NOTE_MAX in contracts): the worker redacts the full text, then cuts to 500.
// 1000 chars is at most 4000 UTF-8 bytes = 5336 base64 chars, within the parser's 5400 limit.
const NOTE_MAX = 1000;
const BLOCK_REASON =
  'Before ending your turn, run `agentdesk-status done "<summary>"` if the task is complete, or `agentdesk-status needs_input "<the question>"` if you need an answer from the human. Then end your turn.';

const stateDir = process.env.AGENTDESK_STATE_DIR || '/home/runner/.agentdesk';
const out = process.env.AGENTDESK_STATUS_OUT || '/proc/1/fd/1';
const stateFile = join(stateDir, 'state.json');
// Per pod (the in-memory run dir is empty in each new pod): the first hook of any kind creates this file, which tells the
// entrypoint's startup check that the agent got past its startup screens. A write failure is not an error here.
const hookSeen = join(process.env.AGENTDESK_RUN_DIR || '/run/agentdesk', 'hook-seen');
let firstInPod = false;
try {
  firstInPod = !existsSync(hookSeen);
  if (firstInPod) {
    mkdirSync(join(hookSeen, '..'), { recursive: true });
    closeSync(openSync(hookSeen, 'a'));
  }
} catch {
  // The run dir is not writable: the startup check may then fire late, which is harmless.
}

// Same rules as toAgentNote in packages/contracts: one line, control chars to space, trimmed, capped (see NOTE_MAX).
const toNote = (raw) =>
  typeof raw === 'string'
    ? raw
        .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
        .trim()
        .slice(0, NOTE_MAX)
    : '';

const readState = () => {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const writeState = (json) => {
  mkdirSync(stateDir, { recursive: true });
  const tmp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, stateFile);
};

const noteArg = (raw) => {
  const note = toNote(raw);
  return note ? Buffer.from(note, 'utf8').toString('base64') : '-';
};

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (!input || typeof input !== 'object' || Array.isArray(input)) process.exit(0);

const state = readState();
let last = typeof state.last === 'string' ? state.last : undefined;
let declared = state.declared;
const snapshot = () => JSON.stringify({ ...(declared ? { declared } : {}), ...(last ? { last } : {}) });
const initial = snapshot();
const emit = (word, rest) => {
  appendFileSync(out, `agentdesk: state ${word}${rest ? ` ${rest}` : ''}\n`);
  last = word;
};
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
switch (input.hook_event_name) {
  case 'UserPromptSubmit':
    declared = undefined;
    emit('working');
    break;
  case 'PreToolUse':
    if (last !== 'working' || firstInPod) {
      // `firstInPod`: a saved `working` from an earlier pod (resume) must not hide a startup needs_input line.
      emit('working');
    }
    break;
  case 'PostToolUse':
    // The tool ran, so an approval that was waiting has been answered.
    if (last === 'needs_input') emit('working');
    break;
  case 'PermissionRequest':
    if (last !== 'needs_input') {
      const tool = isRecord(input.tool_input) ? input.tool_input : {};
      emit('needs_input', `approval ${noteArg(tool.description ?? tool.command)}`);
    }
    break;
  case 'Stop':
    if (declared && (declared.state === 'done' || declared.state === 'needs_input')) {
      emit(declared.state, `declared ${noteArg(declared.summary)}`);
      declared = undefined;
    } else if (input.stop_hook_active !== true) {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason: BLOCK_REASON })}\n`);
    } else {
      emit('needs_input', `undeclared ${noteArg(input.last_assistant_message)}`);
    }
    break;
  default:
    // SessionStart and SessionEnd carry no status.
    break;
}

// PreToolUse fires on every tool call: leave the disk alone when nothing changed.
const next = snapshot();
if (next !== initial) writeState(next);
// Also send the conversation entries written since the last hook. A failure here never changes the status above.
try {
  transcriptStep(input);
} catch {
  // transcriptStep does not throw; this guards the hook's exit code all the same.
}
