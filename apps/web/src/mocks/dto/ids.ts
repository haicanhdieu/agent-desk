// Stable ids for the DTO fixtures and the MSW store. UUIDs are RFC 9562 v4-shaped so `z.uuid()` accepts them;
// the prefix tells the kind apart when reading a URL (a… project, c… connection, d… run, e… rule, f… ignored).
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fixed clock of the fixtures (the boards show 14:0x times on this day). */
export const MOCK_NOW = '2026-11-12T14:14:00.000Z';

export const ids = {
  // better-auth ids are opaque strings, not UUIDs.
  user: { alice: 'user-alice' },
  org: { alice: 'org-alice', acme: 'org-acme' },
  connection: {
    harbor: uuid('c0000000', 1),
    kim: uuid('c0000000', 2),
    dev: uuid('c0000000', 3),
    acme: uuid('c0000000', 4),
  },
  project: {
    invoicerApi: uuid('a0000000', 1),
    invoicerWeb: uuid('a0000000', 2),
    docsSite: uuid('a0000000', 3),
    billingJobs: uuid('a0000000', 4),
    storefront: uuid('a0000000', 5),
  },
  agent: {
    invoicerApi: uuid('a9000000', 1),
    invoicerWeb: uuid('a9000000', 2),
    docsSite: uuid('a9000000', 3),
    billingJobs: uuid('a9000000', 4),
    storefront: uuid('a9000000', 5),
  },
  rule: {
    r1: uuid('e0000000', 1),
    r2: uuid('e0000000', 2),
    r3: uuid('e0000000', 3),
    r4: uuid('e0000000', 4),
    r5: uuid('e0000000', 5),
  },
  /** Run ids: project index * 1000 + run number. */
  run: (projectIndex: number, number: number) => uuid('d0000000', projectIndex * 1000 + number),
  ignored: (n: number) => uuid('f0000000', n),
  /** Ids minted by the MSW store for created records. */
  created: (n: number) => uuid('b0000000', n),
} as const;
