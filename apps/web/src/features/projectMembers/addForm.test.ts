import { ApiError } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { ORG_SWITCHED_MESSAGE } from '../auth/orgResync';
import { addProblem, validateAdd } from './addForm';

const ID = 'b7000000-0000-4000-8000-000000000001';
const problem = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
  new ApiError({ status: 422, type: 'validation', title: 'Validation failed', ...init });

describe('validateAdd', () => {
  it('asks for a person and a role on an empty submit', () => {
    expect(validateAdd({ userId: '', roleId: '' })).toEqual({ userId: 'Choose a person.', roleId: 'Choose a role.' });
  });
  it('asks only for what is missing', () => {
    expect(validateAdd({ userId: ID, roleId: '' })).toEqual({ roleId: 'Choose a role.' });
    expect(validateAdd({ userId: '', roleId: ID })).toEqual({ userId: 'Choose a person.' });
  });
  it('passes a person and a role', () => {
    expect(validateAdd({ userId: ID, roleId: ID })).toBeUndefined();
  });
});

describe('addProblem', () => {
  it('maps /userId to the fixed copy and flags the picker for a refetch', () => {
    const p = addProblem(problem({ errors: [{ pointer: '/userId', detail: 'not an org member' }] }));
    expect(p.fields).toEqual({ userId: 'This person is no longer in the organization.' });
    expect(p.form).toBeUndefined();
  });
  it('maps /roleId to the roleId field with the server message', () => {
    const p = addProblem(problem({ errors: [{ pointer: '/roleId', detail: 'bad role' }] }));
    expect(p.fields).toEqual({ roleId: 'bad role' });
  });
  it('reads the 409 banner from the web copy, not the title or detail', () => {
    const p = addProblem(problem({ status: 409, title: 'Conflict', detail: 'already has a role on this project' }));
    expect(p.conflict).toBe(true);
    expect(p.form).toEqual({
      title: 'This person already has a role on this project.',
      detail: 'Use Change role to change it.',
    });
  });
  it('shows another error as a banner with its request id', () => {
    const p = addProblem(problem({ status: 403, title: 'Forbidden', requestId: 'req-9' }));
    expect(p.form).toEqual({ title: 'Forbidden', requestId: 'req-9' });
  });
});

describe('addProblem: org switched in another tab', () => {
  it('shows the org-switched message, not the already-has-a-role conflict', () => {
    const p = addProblem(problem({ status: 409, type: 'org-mismatch', title: 'Organization mismatch' }));
    expect(p.conflict).toBeUndefined();
    expect(p.form).toEqual({ title: ORG_SWITCHED_MESSAGE });
  });
});
