import type { TicketKind } from '@agentdesk/contracts';

export interface PromptInput {
  skillName: string;
  ticketKind: TicketKind;
  ticketNumber: number;
  repoPath: string;
  /** Untrusted user text; the prompt is passed to the runner as data (env var), never through a shell. */
  args: string;
}

/** Collapses line terminators so an interpolated value can never add lines to the template. */
const oneLine = (v: string): string => v.replace(/[\r\n\u2028\u2029]+/g, ' ');

/** The fixed five-line prompt template (Architecture section 5). Always exactly five lines. */
export function buildPrompt(p: PromptInput): string {
  const kind = p.ticketKind === 'pr' ? 'pull request' : 'issue';
  return [
    `Use the skill "${oneLine(p.skillName)}" on ${kind} #${p.ticketNumber} in ${oneLine(p.repoPath)}.`,
    'Read the ticket and all its comments with the gh CLI before you start.',
    `Arguments from the user: ${oneLine(p.args)}`,
    'When done, report on the ticket as the skill instructs.',
    'Before you end a turn, run `agentdesk-status done "<one-line summary>"` if the task is complete, or `agentdesk-status needs_input "<your question>"` if you need an answer from the human.',
  ].join('\n');
}
