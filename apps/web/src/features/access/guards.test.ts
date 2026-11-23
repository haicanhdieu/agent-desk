import { QueryClient } from '@tanstack/react-query';
import type { AccessDto } from '@agentdesk/contracts';
import { isNotFound } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { requireProjectPermission } from './guards';
import { orgAccessQuery } from './queries';

const P1 = 'a0000000-0000-4000-8000-000000000001';
const P2 = 'a0000000-0000-4000-8000-000000000002';

/** A client whose grants are `dto`: no network. */
function clientWith(dto: AccessDto): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(orgAccessQuery('harbor').queryKey, dto);
  return qc;
}
const refusal = async (qc: QueryClient, project: string) =>
  requireProjectPermission(qc, 'harbor', 'project-audit:read', project).then(
    () => null,
    (e: unknown) => e,
  );

describe('requireProjectPermission', () => {
  it('a project grant without project:read is still in scope: Forbidden, not not-found (ADR-0036 guard order)', async () => {
    const qc = clientWith({
      userId: 'u',
      platformAdmin: false,
      assignments: [
        {
          roleKey: 'custom',
          scope: { type: 'project', projectId: P1 },
          permissions: [{ permission: 'rule:read', condition: 'any' }],
        },
      ],
    });
    const e = await refusal(qc, P1);
    expect(isNotFound(e)).toBe(false);
    expect(e).toMatchObject({ status: 403 });
  });

  it("a project outside every grant's scope is not found", async () => {
    const qc = clientWith({
      userId: 'u',
      platformAdmin: false,
      assignments: [
        {
          roleKey: 'custom',
          scope: { type: 'project', projectId: P1 },
          permissions: [{ permission: 'project-audit:read', condition: 'any' }],
        },
      ],
    });
    expect(isNotFound(await refusal(qc, P2))).toBe(true);
  });
});
