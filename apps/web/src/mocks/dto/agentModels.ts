import type { AgentModelsDto } from '@agentdesk/contracts';

const builtin = [
  { id: 'opus', label: 'opus' },
  { id: 'sonnet', label: 'sonnet' },
  { id: 'haiku', label: 'haiku' },
];

/** The model-list answers of `agents.models`, one per case the Desk → Agent and rule screens must show. */
export const agentModelsFixtures: Record<
  'live' | 'noCredential' | 'unreachable' | 'rejected' | 'empty' | 'disabled',
  AgentModelsDto
> = {
  live: {
    source: 'live',
    reason: null,
    models: [
      { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    ],
  },
  noCredential: { source: 'builtin', reason: 'no_credential', models: builtin },
  unreachable: { source: 'builtin', reason: 'unreachable', models: builtin },
  rejected: { source: 'builtin', reason: 'rejected', models: builtin },
  empty: { source: 'builtin', reason: 'empty', models: builtin },
  disabled: { source: 'builtin', reason: 'disabled', models: builtin },
};
