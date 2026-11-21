import type { PrState } from '@agentdesk/contracts';
import { ids } from './ids';

/**
 * The live PR states `tickets.prStates` answers, per project id and ticket number. A ref that is not listed is unknown.
 * #148 and #133 come from the run fixtures; #102 to #108 match the PR rows of `seedLists({ ignored: 10 })` and the
 * e2e `ticketRuns`. #110 has no state on purpose.
 */
export const prStateFixtures: Record<string, Record<string, PrState>> = {
  [ids.project.invoicerApi]: {
    '133': 'open',
    '148': 'merged',
    '102': 'open',
    '104': 'draft',
    '106': 'merged',
    '108': 'closed',
  },
};
