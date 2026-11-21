import type { OrgChecklistDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { checklistKey, toChecklistSteps } from './checklist';

const P = '11111111-1111-4111-8111-111111111111';

const dto = (projectId: string | null, done: [boolean, boolean, boolean, boolean]): OrgChecklistDto => ({
  complete: false,
  projectId,
  steps: [
    { key: 'connect_code_host', done: done[0] },
    { key: 'create_project', done: done[1] },
    { key: 'add_agent', done: done[2] },
    { key: 'add_rule', done: done[3] },
  ],
});

describe('toChecklistSteps', () => {
  it('BR-13: labels the four steps with the spec copy, in order', () => {
    const steps = toChecklistSteps(dto(null, [false, false, false, false]), 'acme');
    expect(steps.map((s) => s.label)).toEqual([
      'Connect a code host',
      'Create a project',
      'Add an agent',
      'Add a rule',
    ]);
  });

  it('BR-14: carries done from the DTO per step', () => {
    const steps = toChecklistSteps(dto(P, [true, true, false, true]), 'acme');
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ['connect_code_host', true],
      ['create_project', true],
      ['add_agent', false],
      ['add_rule', true],
    ]);
  });

  it('BR-15: with no project every step links to the new-project wizard', () => {
    const steps = toChecklistSteps(dto(null, [false, false, false, false]), 'acme');
    expect(steps.map((s) => s.href)).toEqual(Array(4).fill('/o/acme/projects/new/repo'));
  });

  it('BR-15: with a focus project the agent and rule steps open that project setup, the first two the wizard', () => {
    const steps = toChecklistSteps(dto(P, [true, true, false, false]), 'acme');
    expect(steps.map((s) => s.href)).toEqual([
      '/o/acme/projects/new/repo',
      '/o/acme/projects/new/repo',
      `/o/acme/p/${P}/desk/agent`,
      `/o/acme/p/${P}/desk/rules`,
    ]);
  });

  it('encodes the org slug in every href', () => {
    const steps = toChecklistSteps(dto(P, [true, true, false, false]), 'a b');
    expect(steps.every((s) => s.href.startsWith('/o/a%20b/'))).toBe(true);
  });
});

describe('checklistKey', () => {
  it('lives under the org prefix', () => {
    expect(checklistKey('acme')).toEqual(['org', 'acme', 'checklist']);
  });
});
