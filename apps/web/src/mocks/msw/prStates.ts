import type { PrState, PrStatesResponse } from '@agentdesk/contracts';

/** What `tickets.prStates` does until the store resets: answer late, fail, never answer, or leave out draft and closed. */
export type PrStatesScenario = 'slow' | 'error' | 'pending' | 'partial';

/** sessionStorage key the mocked e2e specs seed before the first load (e2e/mock/mock.ts `setPrStates`). */
export const PR_STATES_SCENARIO_KEY = 'agentdesk.mock.prStates';
export const PR_STATES_SLOW_MS = 3000;

/** Known states of `refs`, in request order; `partial` leaves out draft and closed. */
export function prStateItems(
  states: Readonly<Record<string, PrState>>,
  refs: readonly string[],
  partial: boolean,
): PrStatesResponse['items'] {
  const items: PrStatesResponse['items'] = [];
  for (const ref of refs) {
    const prState = states[ref];
    if (prState === undefined) continue;
    if (partial && (prState === 'draft' || prState === 'closed')) continue;
    items.push({ ref, prState });
  }
  return items;
}
