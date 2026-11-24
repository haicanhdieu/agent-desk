import { PAGE_SIZE_MAX } from '@agentdesk/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { platformAuditFixtures } from '../dto/platform';
import { mockDb } from './db';
import { listPlatformAudit, seedPlatformAudit } from './platformAudit';

const base = platformAuditFixtures[0]!;
const row = (id: string, at: string) => ({ ...base, id, at });
const idsOf = () => listPlatformAudit({ page: 1, pageSize: PAGE_SIZE_MAX }).items.map((e) => e.id);

describe('listPlatformAudit order', () => {
  afterEach(() => mockDb.reset());

  it('puts the larger id first when two entries share a timestamp', () => {
    seedPlatformAudit([row('a-1', '2026-11-19T10:00:00.000Z'), row('b-2', '2026-11-19T10:00:00.000Z')]);
    expect(idsOf()).toEqual(['b-2', 'a-1']);
  });

  it('compares timestamps as instants, with or without milliseconds', () => {
    seedPlatformAudit([row('x', '2026-11-19T10:00:00.500Z'), row('y', '2026-11-19T10:00:00Z')]);
    expect(idsOf()).toEqual(['x', 'y']);
    seedPlatformAudit([row('x', '2026-11-19T10:00:01Z'), row('y', '2026-11-19T10:00:00.999Z')]);
    expect(idsOf()).toEqual(['x', 'y']);
  });
});
