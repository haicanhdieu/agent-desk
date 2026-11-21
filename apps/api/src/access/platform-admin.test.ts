import { describe, expect, it } from 'vitest';
import { isPlatformAdmin } from './platform-admin';

const config = { PLATFORM_ADMIN_EMAILS: ['admin@dev.local', 'ops@x.io'] };

describe('isPlatformAdmin', () => {
  it('is true for a listed, verified email', () => {
    expect(isPlatformAdmin(config, { email: 'admin@dev.local', emailVerified: true })).toBe(true);
  });
  it('is false for a listed but unverified email', () => {
    expect(isPlatformAdmin(config, { email: 'admin@dev.local', emailVerified: false })).toBe(false);
  });
  it('ignores the case of the session email', () => {
    expect(isPlatformAdmin(config, { email: 'Admin@Dev.LOCAL', emailVerified: true })).toBe(true);
  });
  it('is false for an unlisted email', () => {
    expect(isPlatformAdmin(config, { email: 'someone@dev.local', emailVerified: true })).toBe(false);
  });
  it('is false for everyone when the list is empty', () => {
    expect(isPlatformAdmin({ PLATFORM_ADMIN_EMAILS: [] }, { email: '', emailVerified: true })).toBe(false);
  });
  it('does not match on a substring or a suffix', () => {
    expect(isPlatformAdmin(config, { email: 'xadmin@dev.local', emailVerified: true })).toBe(false);
    expect(isPlatformAdmin(config, { email: 'admin@dev.local.evil.io', emailVerified: true })).toBe(false);
  });
});
