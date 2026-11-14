import { z } from 'zod';

/** State an agent declares via the `agentdesk: state …` stdout protocol. */
export const AgentState = z.enum(['working', 'waiting', 'needs_input', 'done']);
export type AgentState = z.infer<typeof AgentState>;

/** Why the state was reported. */
export const AgentStateSource = z.enum(['declared', 'question', 'approval', 'undeclared', 'error']);
export type AgentStateSource = z.infer<typeof AgentStateSource>;

export const WaitingOn = z.enum(['background']);
export type WaitingOn = z.infer<typeof WaitingOn>;

export const AGENT_NOTE_MAX = 500;

const LINE_BREAKS = /[\r\n\u2028\u2029]/;

export const AgentNote = z
  .string()
  .max(AGENT_NOTE_MAX)
  .refine((v) => !LINE_BREAKS.test(v), { message: 'agent note must be a single line' });
export type AgentNote = z.infer<typeof AgentNote>;

// eslint-disable-next-line no-control-regex -- intentionally strips control characters
const CONTROL_RUNS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;

/** Make untrusted agent text safe to store as a note: one line, no control chars, capped. */
export function toAgentNote(raw: string): string {
  return raw.replace(CONTROL_RUNS, ' ').trim().slice(0, AGENT_NOTE_MAX);
}
