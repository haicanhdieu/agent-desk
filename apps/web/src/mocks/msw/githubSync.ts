import { z } from 'zod';

/**
 * What `connections.sync` does until the person signs in with GitHub again: `reauth` answers the 409 "reconnect" problem
 * (the stored GitHub token is dead), `unavailable` the 503 "try later" problem (GitHub is down).
 */
export const GithubSyncScenario = z.enum(['reauth', 'unavailable']);
export type GithubSyncScenario = z.infer<typeof GithubSyncScenario>;

/** sessionStorage key the mocked e2e specs seed before the first load (e2e/mock/mock.ts `setGithubSync`). */
export const GITHUB_SYNC_SCENARIO_KEY = 'agentdesk.mock.githubSync';
