import { z } from 'zod';

/** State an agent declares via the `agentdesk: state …` stdout protocol. */
export const AgentState = z.enum(['working', 'waiting', 'needs_input', 'done']);
export type AgentState = z.infer<typeof AgentState>;

/** Why the state was reported. `startup`: the runner heard nothing from the agent after starting it (e.g. a startup dialog is waiting). */
export const AgentStateSource = z.enum(['declared', 'question', 'approval', 'undeclared', 'error', 'startup']);
export type AgentStateSource = z.infer<typeof AgentStateSource>;

export const WaitingOn = z.enum(['background']);
export type WaitingOn = z.infer<typeof WaitingOn>;

export const AGENT_NOTE_MAX = 500;
/**
 * What the runner may send on the wire: twice the stored cap, so the worker can redact the whole text and only then
 * cut it to AGENT_NOTE_MAX. Capping first would split a secret at the boundary and defeat redaction.
 */
export const AGENT_NOTE_WIRE_MAX = 1000;

const LINE_BREAKS = /[\r\n\u2028\u2029]/;

export const AgentNote = z
  .string()
  .max(AGENT_NOTE_MAX)
  .refine((v) => !LINE_BREAKS.test(v), { message: 'agent note must be a single line' });
export type AgentNote = z.infer<typeof AgentNote>;

// eslint-disable-next-line no-control-regex -- intentionally strips control characters
const CONTROL_RUNS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

function sanitize(raw: string, max: number): string {
  return raw.replace(CONTROL_RUNS, ' ').trim().slice(0, max);
}

/** Make untrusted agent text safe to store as a note: one line, no control chars, capped. */
export function toAgentNote(raw: string): string {
  return sanitize(raw, AGENT_NOTE_MAX);
}

/** Parser-side form of a note: sanitized like `toAgentNote` but only capped at the wire max. Redact, then `toAgentNote`. */
export function toAgentNoteWire(raw: string): string {
  return sanitize(raw, AGENT_NOTE_WIRE_MAX);
}
