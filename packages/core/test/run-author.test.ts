import { describe, expect, it } from 'vitest';
import { resolveRunAuthor } from '../src/run-author';
import type { CodeHostAdapter } from '../src/adapters/types';

const bot = { name: 'agentdesk[bot]', email: 'bot@users.noreply.github.com' };
const botAuthor = { ...bot, authorizedBy: bot.name };

type Host = Pick<CodeHostAdapter, 'commitIdentity'>;
// Stands in for an adapter that forgets to validate: the core guard must still hold.
const trustingHost: Host = {
  commitIdentity: (u) => ({ name: u.login, email: `${u.externalId}+${u.login}@users.noreply.example.com` }),
};
const refusingHost: Host = { commitIdentity: () => null };

describe('resolveRunAuthor', () => {
  it('credits the person who triggered the run', () => {
    expect(resolveRunAuthor({ triggeredBy: 'alice', triggeredByExternalId: '42' }, bot, trustingHost)).toEqual({
      name: 'alice',
      email: '42+alice@users.noreply.example.com',
      authorizedBy: 'alice',
    });
  });

  it('passes the login and external id to the adapter', () => {
    let seen: unknown;
    resolveRunAuthor({ triggeredBy: 'alice', triggeredByExternalId: '42' }, bot, {
      commitIdentity: (u) => ((seen = u), null),
    });
    expect(seen).toEqual({ login: 'alice', externalId: '42' });
  });

  it.each([
    ['no trigger person (older run)', { triggeredBy: null, triggeredByExternalId: '42' }],
    ['the bot itself', { triggeredBy: 'agentdesk[bot]', triggeredByExternalId: '42' }],
    ['no external id', { triggeredBy: 'alice', triggeredByExternalId: null }],
  ])('falls back to the bot for %s', (_label, run) => {
    expect(resolveRunAuthor(run, bot, trustingHost)).toEqual(botAuthor);
  });

  it('falls back to the bot when the adapter refuses the identity', () => {
    expect(resolveRunAuthor({ triggeredBy: 'alice', triggeredByExternalId: '42' }, bot, refusingHost)).toEqual(
      botAuthor,
    );
  });

  it.each([
    ['whitespace in the name', { name: 'a b', email: 'a@x.y' }],
    ['a newline in the email', { name: 'alice', email: 'a@x.y\nz' }],
    ['a control character', { name: 'al\u0007ice', email: 'a@x.y' }],
    ['a leading dash', { name: '-alice', email: 'a@x.y' }],
    ['an empty name', { name: '', email: 'a@x.y' }],
    ['an empty email', { name: 'alice', email: '' }],
  ])('falls back to the bot when an adapter returns an identity with %s', (_label, identity) => {
    const host: Host = { commitIdentity: () => identity };
    expect(resolveRunAuthor({ triggeredBy: 'alice', triggeredByExternalId: '42' }, bot, host)).toEqual(botAuthor);
  });
});
