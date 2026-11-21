import { describe, expect, it } from 'vitest';
import { ALLOWED_AUTH_PATHS, isBlockedAuthPath } from './allowed-paths';

describe('isBlockedAuthPath', () => {
  it('lists exactly the agreed allow-list', () => {
    expect([...ALLOWED_AUTH_PATHS]).toEqual([
      '/get-session',
      '/sign-in/social',
      '/callback/*',
      '/sign-out',
      '/organization/list',
      '/organization/set-active',
      '/ok',
      '/error',
    ]);
  });

  it.each([
    '/auth/get-session',
    '/auth/sign-in/social',
    '/auth/callback/github',
    '/auth/sign-out',
    '/auth/organization/list',
    '/auth/organization/set-active',
    '/auth/ok',
    '/auth/error',
  ])('%s is open', (path) => {
    expect(isBlockedAuthPath(path)).toBe(false);
  });

  it.each([
    '/auth/callback',
    '/auth/callback/',
    '/auth/callback/a/b',
    '/auth/organization/list-members',
    '/auth/organization/list/extra',
    '/auth/organization',
    '/auth/organization/get-full-organization',
    '/auth/sign-in/email',
    '/auth/sign-up/email',
    '/auth/update-user',
    '/auth/list-sessions',
    '/auth/get-session/extra',
    '/auth/okay',
    '/auth/',
    '/auth',
    '/authx/get-session',
    '/get-session',
    '/auth/organization%2flist',
  ])('%s is blocked', (path) => {
    expect(isBlockedAuthPath(path)).toBe(true);
  });
});
