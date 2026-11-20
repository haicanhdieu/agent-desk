import type { TicketKind } from '@agentdesk/contracts';

export type PromptSource = { skillName: string } | { customPrompt: string };

export type PromptInput = PromptSource & {
  ticketKind: TicketKind;
  ticketNumber: number;
  repoPath: string;
  /** Untrusted user text; the prompt is passed to the runner as data (env var), never through a shell. */
  args: string;
};

export const PROMPT_PREVIEW_TICKET = '<issue or PR #number>';
export const PROMPT_PREVIEW_ARGS = '<text after /command>';

/** Collapses line terminators so an interpolated value can never add lines to the template. */
const oneLine = (v: string): string => v.replace(/[\r\n\u2028\u2029]+/g, ' ');

/** Tells the agent to keep within the pod's limits: an OOM kill ends the whole run. Fixed text, nothing interpolated. */
const RESOURCE_RULE_LINE =
  'RULE: RAM is capped (/sys/fs/cgroup/memory.max); exceeding it kills the pod. You MUST check memory before heavy tasks and order parallel work to fit, and MUST kill unused processes and shells and delete temp files.';

/** The five lines Agent Desk appends after a custom prompt; `ticket` is e.g. `issue #7`. */
export function promptSystemLines(p: { ticket: string; repoPath: string; args: string }): string[] {
  return [
    `Ticket: ${p.ticket} in ${oneLine(p.repoPath)}. Read it and all its comments with the gh CLI before you start.`,
    `Arguments from the user: ${oneLine(p.args)}`,
    'When done, report on the ticket.',
    RESOURCE_RULE_LINE,
    'Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.',
  ];
}

/** Picks the prompt source of a rule or run row: the skill wins; a null skill falls back to the prompt. */
export function promptSourceOf(row: { skillName: string | null; prompt: string | null }): PromptSource {
  if (row.skillName !== null) return { skillName: row.skillName };
  if (row.prompt !== null) return { customPrompt: row.prompt };
  throw new Error('run has neither a skill nor a prompt');
}

/** Six lines for a skill rule; the custom prompt plus five system lines otherwise. */
export function buildPrompt(p: PromptInput): string {
  const kind = p.ticketKind === 'pr' ? 'pull request' : 'issue';
  if ('customPrompt' in p) {
    return [
      p.customPrompt,
      ...promptSystemLines({ ticket: `${kind} #${p.ticketNumber}`, repoPath: p.repoPath, args: p.args }),
    ].join('\n');
  }
  return [
    `Use the skill "${oneLine(p.skillName)}" on ${kind} #${p.ticketNumber} in ${oneLine(p.repoPath)}.`,
    'Read the ticket and all its comments with the gh CLI before you start.',
    `Arguments from the user: ${oneLine(p.args)}`,
    'When done, report on the ticket as the skill instructs.',
    RESOURCE_RULE_LINE,
    'Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.',
  ].join('\n');
}
