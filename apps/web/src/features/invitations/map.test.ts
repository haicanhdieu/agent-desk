import type { MyInvitationDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { accessLine, toAcceptState, toInvitationCard } from './map';

const dto: MyInvitationDto = {
  id: 'c1000000-0000-4000-8000-000000000001',
  org: { id: 'b5000000-0000-4000-8000-000000000001', name: 'Acme Robotics', slug: 'acme-robotics' },
  role: { key: 'member', name: 'Member' },
  scope: { type: 'org' },
  invitedBy: { name: 'Ada Lovelace', handle: 'ada' },
  expiresAt: '2026-11-23T14:05:00.000Z',
  status: 'pending',
};

describe('accessLine', () => {
  it('reads "Whole organization" for org scope', () => {
    expect(accessLine({ type: 'org' })).toBe('Whole organization');
  });

  it('lists the project names for project scope', () => {
    expect(
      accessLine({
        type: 'project',
        projects: [
          { id: 'p1', name: 'invoicer-api' },
          { id: 'p2', name: 'invoicer-web' },
        ],
      }),
    ).toBe('invoicer-api, invoicer-web');
  });
});

describe('toInvitationCard', () => {
  it('maps org, role, access and expiry', () => {
    const card = toInvitationCard(dto);
    expect(card).toMatchObject({
      id: dto.id,
      orgName: 'Acme Robotics',
      roleName: 'Member',
      access: 'Whole organization',
    });
    expect(card.expires.dateTime).toBe('2026-11-23T14:05:00.000Z');
    expect(card.expires.text).toMatch(/^\d{1,2} \w{3}, \d{2}:\d{2}$/);
    expect(card.expires.title).toMatch(/^\d{1,2} \w{3} 2026, \d{2}:\d{2}$/);
  });

  it('keeps invitedBy.name as given (BR-52)', () => {
    expect(toInvitationCard(dto).inviter).toBe('Ada Lovelace');
    expect(toInvitationCard({ ...dto, invitedBy: { name: 'ada', handle: 'ada' } }).inviter).toBe('ada');
  });

  it('keeps a deleted inviter as null (BR-52)', () => {
    expect(toInvitationCard({ ...dto, invitedBy: null }).inviter).toBeNull();
  });
});

describe('toAcceptState', () => {
  it('maps a pending invitation to the details with nothing busy and no dialog', () => {
    expect(toAcceptState(dto)).toEqual({
      kind: 'pending',
      busy: null,
      confirmDecline: false,
      details: expect.objectContaining({
        id: dto.id,
        orgName: 'Acme Robotics',
        orgSlug: 'acme-robotics',
        roleName: 'Member',
        access: 'Whole organization',
        inviter: 'Ada Lovelace',
        status: 'pending',
      }),
    });
  });

  it('maps accepted to a link to the org projects with the slug encoded', () => {
    expect(toAcceptState({ ...dto, status: 'accepted', org: { ...dto.org, slug: 'a b' } })).toEqual({
      kind: 'accepted',
      orgName: 'Acme Robotics',
      orgHref: '/o/a%20b/projects',
    });
  });

  it('maps declined to a link to the invitations list', () => {
    expect(toAcceptState({ ...dto, status: 'declined' })).toEqual({
      kind: 'declined',
      invitationsHref: '/invitations',
    });
  });

  it('maps revoked to the revoked state', () => {
    expect(toAcceptState({ ...dto, status: 'revoked' })).toEqual({ kind: 'revoked' });
  });

  it('maps expired to the org and the inviter name, or a null inviter (BR-48)', () => {
    expect(toAcceptState({ ...dto, status: 'expired' })).toEqual({
      kind: 'expired',
      orgName: 'Acme Robotics',
      inviter: 'Ada Lovelace',
    });
    expect(toAcceptState({ ...dto, status: 'expired', invitedBy: null })).toEqual({
      kind: 'expired',
      orgName: 'Acme Robotics',
      inviter: null,
    });
  });
});
