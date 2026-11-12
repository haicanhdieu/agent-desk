import type { TicketKind } from '@agentdesk/contracts';

export interface PromptInput {
  skillName: string;
  ticketKind: TicketKind;
  ticketNumber: number;
  repoPath: string;
  /** Untrusted user text; the prompt is passed to the runner as data (env var), never through a shell. */
  args: string;
}

/** The fixed four-line prompt template (Architecture section 5). */
export function buildPrompt(p: PromptInput): string {
  const kind = p.ticketKind === 'pr' ? 'pull request' : 'issue';
  return [
    `Use the skill "${p.skillName}" on ${kind} #${p.ticketNumber} in ${p.repoPath}.`,
    'Read the ticket and all its comments with the gh CLI before you start.',
    `Arguments from the user: ${p.args}`,
    'When done, report on the ticket as the skill instructs.',
  ].join('\n');
}
