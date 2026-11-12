import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { setScenarioTarget } from './scenarios';

/** MSW server for Vitest (lifecycle in src/test/setup.ts). */
export const server = setupServer(...handlers);
setScenarioTarget(server);
