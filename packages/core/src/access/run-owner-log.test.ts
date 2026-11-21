import { describe, expect, it } from 'vitest';
import { runOwnerLogFields } from './run-owner';

const event = { author: 'alice', authorId: '42', ticketRef: '7', createdAt: '2026-01-01T00:00:00Z' };

describe('runOwnerLogFields', () => {
  it('names the owner and the human origin', () => {
    expect(runOwnerLogFields({ kind: 'owner', userId: 'u1', originRunId: null }, event, 'agentdesk[bot]')).toEqual({
      origin: 'human',
      outcome: 'owner',
      ownerUserId: 'u1',
    });
  });

  it('names the origin run for a bot comment', () => {
    expect(
      runOwnerLogFields(
        { kind: 'owner', userId: 'u1', originRunId: 'r1' },
        { ...event, author: 'agentdesk[bot]' },
        'agentdesk[bot]',
      ),
    ).toEqual({ origin: 'bot', outcome: 'owner', ownerUserId: 'u1', originRunId: 'r1' });
  });

  it('gives the outcome of an ignored comment and nothing from the ticket or the commenter', () => {
    const fields = runOwnerLogFields(
      { kind: 'ignored', outcome: 'ignored_owner_unlinked', detail: 'commenter is not linked to an Agent Desk user' },
      event,
      'agentdesk[bot]',
    );
    expect(fields).toEqual({ origin: 'human', outcome: 'ignored_owner_unlinked' });
    expect(JSON.stringify(fields)).not.toContain('alice');
  });

  it('treats an empty bot login as no bot', () => {
    expect(
      runOwnerLogFields({ kind: 'owner', userId: 'u1', originRunId: null }, { ...event, author: '' }, '').origin,
    ).toBe('human');
  });
});
