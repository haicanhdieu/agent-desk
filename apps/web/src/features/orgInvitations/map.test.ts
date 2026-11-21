import type { InvitationDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@agentdesk/contracts/client';
import { failureTitle, toOrgInvitationRow } from './map';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const ID = '0b1c0000-0000-4000-8000-000000000001';

const dto = (patch: Partial<InvitationDto> = {}): InvitationDto => ({
  id: ID,
  email: 'p@x.dev',
  role: { id: '0b1c0000-0000-4000-8000-0000000000r1', key: 'member', name: 'Member' },
  scope: { type: 'org' },
  status: 'pending',
  expiresAt: '2026-11-23T12:00:00.000Z',
  invitedBy: { name: 'Ada Lovelace', handle: 'ada' },
  createdAt: '2026-11-21T11:00:00.000Z',
  acceptedAt: null,
  ...patch,
});

describe('toOrgInvitationRow', () => {
  it.each([
    ['pending', ['copy', 'resend', 'revoke']],
    ['expired', ['resend']],
    ['accepted', []],
    ['declined', []],
    ['revoked', []],
  ] as const)('BR-19 a %s row offers %j', (status, actions) => {
    expect(toOrgInvitationRow(dto({ status }), NOW).actions).toEqual(actions);
  });

  it('maps the columns', () => {
    const row = toOrgInvitationRow(dto(), NOW);
    expect(row).toMatchObject({
      id: ID,
      email: 'p@x.dev',
      role: 'Member',
      access: 'Whole organization',
      status: 'pending',
      invitedBy: 'Ada Lovelace',
    });
    expect(row.expires.kind).toBe('relative');
  });

  it('lists the project names as the access', () => {
    const scope: InvitationDto['scope'] = {
      type: 'project',
      projects: [
        { id: ID, name: 'invoicer-api' },
        { id: ID, name: 'invoicer-web' },
      ],
    };
    expect(toOrgInvitationRow(dto({ scope }), NOW).access).toBe('invoicer-api, invoicer-web');
  });

  it('BR-52 keeps the inviter name as given and a deleted inviter is null', () => {
    expect(toOrgInvitationRow(dto({ invitedBy: { name: 'bob', handle: 'bob' } }), NOW).invitedBy).toBe('bob');
    expect(toOrgInvitationRow(dto({ invitedBy: null }), NOW).invitedBy).toBeNull();
  });
});

describe('failureTitle', () => {
  const problem = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
    new ApiError({ status: 409, type: 'conflict', title: 'Conflict', ...init });

  it('BR-19 on a 409 takes the sentence from the detail (the API) or the title (the mock)', () => {
    expect(failureTitle(problem({ detail: 'Invitation is no longer pending' }))).toBe(
      'Invitation is no longer pending',
    );
    expect(failureTitle(problem({ title: 'Invitation is no longer pending' }))).toBe('Invitation is no longer pending');
  });

  it('BR-50 prefers the /email field detail', () => {
    const errors = [{ pointer: '/email', detail: 'This email already has a pending invitation.' }];
    expect(failureTitle(problem({ title: 'Email already invited', errors }))).toBe(
      'This email already has a pending invitation.',
    );
  });

  it('uses the title of other problems and a generic line for anything else', () => {
    expect(failureTitle(problem({ status: 500, type: 'internal', title: 'Internal server error' }))).toBe(
      'Internal server error',
    );
    expect(failureTitle(new Error('boom'))).toBe('Something went wrong');
  });
});
