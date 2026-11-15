#!/usr/bin/env node
// Agent-neutral declare command: `agentdesk-status <done|needs_input> "<summary>"`.
// Records the agent's declaration for the current turn; the per-agent adapter
// turns it into a protocol line when the turn ends. Never writes protocol lines.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATES = ['done', 'needs_input'];
const stateDir = process.env.AGENTDESK_STATE_DIR || '/home/runner/.agentdesk';
const [state, summary, ...extra] = process.argv.slice(2);

if (!STATES.includes(state) || typeof summary !== 'string' || extra.length > 0) {
  process.stderr.write('usage: agentdesk-status <done|needs_input> "<one line summary>"\n');
  process.exit(2);
}

const file = join(stateDir, 'state.json');
let current = {};
try {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
} catch {
  // missing or unreadable state starts fresh
}
mkdirSync(stateDir, { recursive: true });
const tmp = `${file}.${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify({ ...current, declared: { state, summary } }));
renameSync(tmp, file);
process.stdout.write(`status recorded: ${state}\n`);
