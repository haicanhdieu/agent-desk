import type { MyInvitationDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { accessLine, toInvitationCard } from './map';

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
