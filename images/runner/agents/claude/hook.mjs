#!/usr/bin/env node
// Claude Code adapter: maps hook events to `agentdesk: state ...` protocol lines
// (docs/superpowers/specs/2026-11-14-agent-run-status-design.md section 6.2).
// Hook input is untrusted text and is only ever used as data (never a shell).
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NOTE_MAX = 500;
const BLOCK_REASON =
  'Before ending your turn, run `agentdesk-status done "<summary>"` if the task is complete, or `agentdesk-status needs_input "<the question>"` if you need an answer from the human. Then end your turn.';

const stateDir = process.env.AGENTDESK_STATE_DIR || '/home/runner/.agentdesk';
const out = process.env.AGENTDESK_STATUS_OUT || '/proc/1/fd/1';
const stateFile = join(stateDir, 'state.json');

// Same rules as toAgentNote in packages/contracts: one line, control chars to space, trimmed, capped.
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
const writeState = (s) => {
  mkdirSync(stateDir, { recursive: true });
  const tmp = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
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
const emit = (word, rest) => {
  appendFileSync(out, `agentdesk: state ${word}${rest ? ` ${rest}` : ''}\n`);
  last = word;
};
const nonEmpty = (v) => Array.isArray(v) && v.length > 0;
const isAsk = input.tool_name === 'AskUserQuestion';

switch (input.hook_event_name) {
  case 'UserPromptSubmit':
    declared = undefined;
    emit('working');
    break;
  case 'PreToolUse':
    if (isAsk) {
      const q = Array.isArray(input.tool_input?.questions) ? input.tool_input.questions[0]?.question : undefined;
      emit('needs_input', `question ${noteArg(q)}`);
    } else if (last !== 'working') {
      emit('working');
    }
    break;
  case 'PostToolUse':
    if (isAsk) emit('working');
    break;
  case 'Notification':
    if (
      (input.notification_type === 'permission_prompt' || input.notification_type === 'elicitation_dialog') &&
      last !== 'needs_input'
    ) {
      emit('needs_input', `approval ${noteArg(input.message)}`);
    }
    break;
  case 'Stop':
    if (declared && (declared.state === 'done' || declared.state === 'needs_input')) {
      emit(declared.state, `declared ${noteArg(declared.summary)}`);
      declared = undefined;
    } else if (nonEmpty(input.background_tasks) || nonEmpty(input.session_crons)) {
      emit('waiting', 'background');
    } else if (input.stop_hook_active !== true) {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason: BLOCK_REASON })}\n`);
    } else {
      emit('needs_input', `undeclared ${noteArg(input.last_assistant_message)}`);
    }
    break;
  case 'StopFailure':
    emit('needs_input', 'error -');
    break;
  default:
    break;
}

writeState({ ...(declared ? { declared } : {}), ...(last ? { last } : {}) });
