import type { AccessDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { tenantAccessFixtures } from '@/mocks/dto/access';
import { ids } from '@/mocks/dto/ids';
import { toAccess } from '../access/queries';
import type { MenuItemKey } from '../chrome/routeChrome';
import { projectPaths } from '../desk/frame';
import { switchTargetHref } from './switchTarget';

const P1 = ids.project.invoicerApi;
const P2 = ids.project.invoicerWeb;
const owner = toAccess(tenantAccessFixtures.owner);
const viewer = toAccess(tenantAccessFixtures.viewer);
const paths = projectPaths('acme', P2);

// Alice administers P1 and can only read P2, with nothing org-wide (the `adminP1ViewerP2` scenario).
const adminP1ViewerP2 = (): AccessDto => {
  const viewerLines = tenantAccessFixtures.viewer.assignments[0]?.permissions ?? [];
  return {
    ...tenantAccessFixtures.projectAdmin,
    assignments: [
      ...tenantAccessFixtures.projectAdmin.assignments,
      { roleKey: 'viewer', scope: { type: 'project', projectId: P2 }, permissions: viewerLines },
    ],
  };
};

describe('switchTargetHref (BR-51, BR-52)', () => {
  it.each([
    ['runs', paths.runs],
    ['rules', paths.rules],
    ['skills', paths.skills],
    ['setup', paths.setup],
    ['agent', paths.agent],
    ['projectMembers', paths.members],
    ['projectAudit', paths.audit],
  ] as const)('keeps the %s page when the target allows it', (item, href) => {
    expect(switchTargetHref('acme', P2, item, false, owner)).toBe(href);
  });

  it('falls back to Runs when the target does not allow the section', () => {
    expect(switchTargetHref('acme', P2, 'projectAudit', false, viewer)).toBe(paths.runs);
    expect(switchTargetHref('acme', P2, 'agent', false, viewer)).toBe(paths.runs);
  });

  it('opens Runs from a run page (parent), whatever the item', () => {
    expect(switchTargetHref('acme', P2, 'runs', true, owner)).toBe(paths.runs);
    expect(switchTargetHref('acme', P2, 'rules', true, owner)).toBe(paths.runs);
  });

  it('opens Runs for an unknown item and while the access is not loaded', () => {
    expect(switchTargetHref('acme', P2, undefined, false, owner)).toBe(paths.runs);
    expect(switchTargetHref('acme', P2, 'orgMembers' satisfies MenuItemKey, false, owner)).toBe(paths.runs);
    expect(switchTargetHref('acme', P2, 'rules', false, undefined)).toBe(paths.runs);
  });

  it('never carries a search: from Agent & settings it is the agent page with no tab, agent or page', () => {
    const href = switchTargetHref('acme', P2, 'agent', false, owner);
    expect(href).toBe(`/o/acme/p/${P2}/desk/agent`);
    expect(href).not.toMatch(/[?&#]|tab|page/);
  });

  it('without agent:read on the target, Agent & settings gives Runs', () => {
    const access = toAccess(adminP1ViewerP2());
    expect(switchTargetHref('acme', P1, 'agent', false, access)).toBe(projectPaths('acme', P1).agent);
    expect(switchTargetHref('acme', P2, 'agent', false, access)).toBe(paths.runs);
  });

  it('adminP1ViewerP2 from P1 rules to P2 gives P2 Runs', () => {
    const access = toAccess(adminP1ViewerP2());
    expect(switchTargetHref('acme', P2, 'rules', false, access)).toBe(paths.runs);
  });
});
