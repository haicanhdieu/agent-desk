import { describe, expect, it } from 'vitest';
import { resolveStep } from './resume';
import { SetupSearch, SETUP_STEPS } from './steps';

describe('resolveStep', () => {
  it.each([
    // [requested, server setupStep (null = no project), expected]
    ['rules', 'agent', 'agent'],
    ['ready', 'skills', 'skills'],
    ['skills', 'skills', 'skills'],
    ['agent', 'rules', 'agent'],
    ['repo', 'rules', 'repo'],
    ['ready', 'ready', 'ready'],
    ['agent', null, 'repo'],
    ['ready', null, 'repo'],
    ['repo', null, 'repo'],
  ] as const)('requested %s, server %s → %s', (requested, setupStep, expected) => {
    expect(resolveStep(requested, setupStep === null ? null : { setupStep })).toBe(expected);
  });
});

describe('setup search', () => {
  it('keeps uuid project and connection ids', () => {
    const project = 'a0000000-0000-4000-8000-000000000001';
    const connection = 'c0000000-0000-4000-8000-000000000003';
    expect(SetupSearch.parse({ project, connection })).toEqual({ project, connection });
  });

  it('drops invalid values instead of failing', () => {
    expect(SetupSearch.parse({ project: 'nope', connection: 42 })).toEqual({
      project: undefined,
      connection: undefined,
    });
  });

  it('lists the five steps in order', () => {
    expect(SETUP_STEPS).toEqual(['repo', 'agent', 'skills', 'rules', 'ready']);
  });
});
