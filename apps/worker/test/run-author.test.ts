import { describe, expect, it } from 'vitest';
import type { CodeHostAdapter } from '@agentdesk/core';
import { resolveRunAuthor } from '../src/activities/run.activities.impl';

const bot = { name: 'agentdesk[bot]', email: 'bot@users.noreply.github.com' };
const host = {
  commitIdentity: (u: { login: string; externalId: string }) => ({
    name: u.login,
    email: `${u.externalId}+${u.login}@users.noreply.github.com`,
  }),
} as unknown as CodeHostAdapter; // only commitIdentity is exercised

const botAuthor = { ...bot, authorizedBy: bot.name };

describe('resolveRunAuthor', () => {
  it('credits the person who triggered the run', () => {
    expect(resolveRunAuthor({ triggeredBy: 'alice', triggeredByExternalId: '42' }, bot, host)).toEqual({
      name: 'alice',
      email: '42+alice@users.noreply.github.com',
      authorizedBy: 'alice',
    });
  });

  it.each([
    ['no trigger person (older run)', { triggeredBy: null, triggeredByExternalId: '42' }],
    ['the bot itself', { triggeredBy: 'agentdesk[bot]', triggeredByExternalId: '42' }],
    ['no external id', { triggeredBy: 'alice', triggeredByExternalId: null }],
    ['a login with a shell separator', { triggeredBy: 'a;b', triggeredByExternalId: '42' }],
    ['a login that looks like a flag', { triggeredBy: '--x y', triggeredByExternalId: '42' }],
    ['a login with command substitution', { triggeredBy: '$(touch x)', triggeredByExternalId: '42' }],
    ['a login with a newline', { triggeredBy: 'alice\nmallory', triggeredByExternalId: '42' }],
    ['a login that starts with a dash', { triggeredBy: '-alice', triggeredByExternalId: '42' }],
    ['the ghost user of a deleted account', { triggeredBy: 'ghost', triggeredByExternalId: null }],
    ['a non-numeric external id', { triggeredBy: 'alice', triggeredByExternalId: '4 2;x' }],
  ])('falls back to the bot for %s', (_label, run) => {
    expect(resolveRunAuthor(run, bot, host)).toEqual(botAuthor);
  });
});
