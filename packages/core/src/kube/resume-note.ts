/** Why a run's pod ended without the agent finishing (the cases that resume automatically). */
export const UNEXPECTED_END_KINDS = ['killed', 'lost', 'signal', 'session_gone', 'agent_exit'] as const;
export type UnexpectedEndKind = (typeof UNEXPECTED_END_KINDS)[number];
export interface UnexpectedEnd {
  kind: UnexpectedEndKind;
  exitCode?: number;
  podReason?: string;
}
/** `try`/`max` only on an automatic resume. */
export interface ResumeNoteInput {
  end: UnexpectedEnd;
  try?: number;
  max?: number;
}

/** A pod kill reason is a single plain word; anything else is dropped (it reaches the agent's prompt). */
export const POD_REASON_PATTERN = /^[A-Za-z]{1,40}$/;

/** The reason word when it matches POD_REASON_PATTERN, else undefined. */
export function usablePodReason(reason: string | null | undefined): string | undefined {
  return typeof reason === 'string' && POD_REASON_PATTERN.test(reason) ? reason : undefined;
}

function usableExitCode(code: number | undefined): number | undefined {
  return typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255 ? code : undefined;
}

/** Activity args are plain JSON: a count reaches the prompt only as a whole number of 1..10. */
function usableCount(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 10;
}

/** The bracket of the spec's §4 table; `memoryLimit` is RUN_POD_MEMORY_LIMIT. Re-checks podReason and exitCode. */
export function resumeBracket(end: UnexpectedEnd, memoryLimit: string): string {
  const exit = usableExitCode(end.exitCode);
  switch (end.kind) {
    case 'killed': {
      const reason = usablePodReason(end.podReason);
      const parts: string[] = [];
      if (reason) parts.push(reason);
      if (exit !== undefined) parts.push(`exit ${exit}`);
      if (reason === 'OOMKilled') parts.push(`limit ${memoryLimit}`);
      return parts.length > 0 ? parts.join(', ') : 'exit unknown';
    }
    case 'lost':
      return 'pod lost, no exit code';
    case 'signal':
      return 'SIGTERM from outside';
    case 'session_gone':
      return 'terminal session died';
    case 'agent_exit':
      return exit !== undefined ? `agent CLI exited with code ${exit}` : 'agent CLI exited';
  }
}

/** The fixed note the agent reads as `RESUME_NOTE`. Built only from checked values, never from ticket text. */
export function resumeNoteText(note: ResumeNoteInput, memoryLimit: string): string {
  const tries = usableCount(note.try) && usableCount(note.max) ? `, try ${note.try}/${note.max}` : '';
  return `Agent Desk: your last session was killed (${resumeBracket(note.end, memoryLimit)}). Resumed${tries}. Background processes and /tmp are gone.`;
}

export function autoResumeEventText(
  input: { end: UnexpectedEnd; try: number; max: number },
  memoryLimit: string,
): string {
  const tries = usableCount(input.try) && usableCount(input.max) ? `, try ${input.try} of ${input.max}` : '';
  return `The last session was killed (${resumeBracket(input.end, memoryLimit)}). Resuming automatically${tries}.`;
}

export function autoResumeGaveUpText(tries: number): string {
  if (!usableCount(tries)) return 'Gave up resuming automatically.';
  return `Gave up resuming automatically after ${tries} ${tries === 1 ? 'try' : 'tries'}.`;
}
