import type { ConnectionDto, RepoDto } from '@agentdesk/contracts';
import { ids } from './ids';

// Org alice is installed on the harbor-labs and kim-hale GitHub accounts (the view fixtures' repos) and has the
// `fake` provider for local runs; org acme has its own installation.
export const connectionFixtures: ConnectionDto[] = [
  {
    id: ids.connection.harbor,
    provider: 'github',
    capabilities: { code: true, board: true },
    accountName: 'harbor-labs',
    status: 'active',
    createdAt: '2026-09-02T09:15:00.000Z',
  },
  {
    id: ids.connection.kim,
    provider: 'github',
    capabilities: { code: true, board: true },
    accountName: 'kim-hale',
    status: 'active',
    createdAt: '2026-10-01T08:00:00.000Z',
  },
  {
    id: ids.connection.dev,
    provider: 'fake',
    capabilities: { code: true, board: true },
    accountName: 'dev',
    status: 'active',
    createdAt: '2026-11-01T08:00:00.000Z',
  },
  {
    id: ids.connection.acme,
    provider: 'github',
    capabilities: { code: true, board: true },
    accountName: 'acme-co',
    status: 'active',
    createdAt: '2026-10-20T10:00:00.000Z',
  },
];

/** Org that owns each connection. */
export const connectionOrg: Record<string, string> = {
  [ids.connection.harbor]: ids.org.alice,
  [ids.connection.kim]: ids.org.alice,
  [ids.connection.dev]: ids.org.alice,
  [ids.connection.acme]: ids.org.acme,
};

const repo = (repoPath: string, isPrivate = true): RepoDto => ({ repoPath, private: isPrivate, defaultBranch: 'main' });

export const repoFixtures: Record<string, RepoDto[]> = {
  [ids.connection.harbor]: [
    repo('harbor-labs/invoicer-api'),
    repo('harbor-labs/invoicer-web'),
    repo('harbor-labs/billing-jobs'),
    repo('harbor-labs/payments-ledger'),
  ],
  [ids.connection.kim]: [repo('kim-hale/docs-site', false)],
  [ids.connection.dev]: [repo('dev/demo', false), repo('dev/sandbox', false)],
  [ids.connection.acme]: [repo('acme-co/storefront')],
};
