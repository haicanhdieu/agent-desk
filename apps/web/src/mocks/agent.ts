import type { AgentSettings } from './types';

// Prototype board: DeskAgent (Agent, Credential, Limits).
export const agentSettings: AgentSettings = {
  agent: 'Claude',
  model: 'opus (latest Opus)',
  credential: {
    type: 'oauth_token',
    setAt: '12 Oct 2026',
    setBy: 'kim-hale',
    status: { tone: 'err', text: 'Rejected at 11:29' },
  },
  timeoutMinutes: 30,
  pausedKeepMinutes: 10080,
  doneKeepMinutes: 1440,
  idleEndMinutes: 30,
  maxConcurrent: 2,
  maxRunsPerTicket: 10,
};
