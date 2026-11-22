import { describe, expect, it } from 'vitest';
import { pageOf } from './page';
import {
  CreateOrgRequest,
  GrantPlatformAdminRequest,
  OrgDto,
  PlatformAdminDto,
  PlatformMemberDto,
  PlatformRoleDto,
  UpdateOrgRequest,
} from './platform';

const ID = '33333333-3333-4333-8333-333333333333';

describe('CreateOrgRequest', () => {
  const ok = { name: 'Acme', slug: 'acme' };
  it('accepts a 100-char name', () => {
    expect(CreateOrgRequest.safeParse({ ...ok, name: 'n'.repeat(100) }).success).toBe(true);
  });
  it.each([
    ['missing name', { slug: 'acme' }, 'name'],
    ['missing slug', { name: 'Acme' }, 'slug'],
    ['101-char name', { ...ok, name: 'n'.repeat(101) }, 'name'],
    ['bad slug', { ...ok, slug: '-x' }, 'slug'],
  ])('rejects %s at the field', (_n, body, field) => {
    const r = CreateOrgRequest.safeParse(body);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual([field]);
  });
});

describe('PlatformMemberDto', () => {
  it('requires email', () => {
    expect(PlatformMemberDto.safeParse({ userId: 'u', handle: null, name: 'N', assignments: [] }).success).toBe(false);
    expect(
      PlatformMemberDto.safeParse({ userId: 'u', handle: null, name: 'N', email: 'a@b.co', assignments: [] }).success,
    ).toBe(true);
  });
});

describe('PlatformRoleDto', () => {
  it('parses a RoleDto fixture', () => {
    expect(
      PlatformRoleDto.safeParse({
        id: ID,
        key: 'admin',
        name: 'Admin',
        builtIn: true,
        assignableScopes: ['org'],
        permissions: [{ permission: 'project:read', condition: 'any' }],
      }).success,
    ).toBe(true);
  });
});

describe('GrantPlatformAdminRequest', () => {
  const tail = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  const long254 = `${'a'.repeat(64)}@${tail}`;
  it('accepts a 254-character email', () => {
    expect(long254).toHaveLength(254);
    expect(GrantPlatformAdminRequest.safeParse({ email: long254 }).success).toBe(true);
  });
  it.each([
    ['empty body', {}],
    ['not an email', { email: 'not-an-email' }],
    ['255-character email', { email: `a${long254}` }],
  ])('rejects %s at the email field', (_n, body) => {
    const r = GrantPlatformAdminRequest.safeParse(body);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['email']);
  });
  it('rejects an unknown key', () => {
    expect(GrantPlatformAdminRequest.safeParse({ email: 'a@b.co', extra: 1 }).success).toBe(false);
  });
  it('trims and lowercases', () => {
    expect(GrantPlatformAdminRequest.parse({ email: '  E2E-AB@DEV.LOCAL  ' }).email).toBe('e2e-ab@dev.local');
  });
});

describe('PlatformAdminDto', () => {
  const base = { id: ID, email: 'a@dev.local', grantedAt: '2026-01-01T00:00:00.000Z' };
  const entries = [
    { ...base, userId: 'u1', name: 'Admin', handle: 'admin', grantedBy: null },
    { ...base, userId: 'u2', name: 'Bo', handle: 'bo', grantedBy: { name: 'Admin', handle: 'admin' } },
    { ...base, userId: null, name: null, handle: null, grantedBy: null },
  ];
  it('parses an entry with no account and no granter', () => {
    expect(PlatformAdminDto.safeParse(entries[2]).success).toBe(true);
  });
  it('parses a page of entries', () => {
    expect(pageOf(PlatformAdminDto).safeParse({ items: entries, page: 1, pageSize: 20, total: 3 }).success).toBe(true);
  });
  it('rejects a granter without a handle', () => {
    expect(PlatformAdminDto.safeParse({ ...entries[1], grantedBy: { name: 'x' } }).success).toBe(false);
  });
});

describe('UpdateOrgRequest', () => {
  it.each([
    ['empty body', {}],
    ['empty name', { name: '' }],
    ['101-char name', { name: 'a'.repeat(101) }],
    ['uppercase slug', { slug: 'Acme' }],
    ['leading dash slug', { slug: '-acme' }],
    ['64-char slug', { slug: 'a'.repeat(64) }],
  ])('rejects %s', (_n, body) => {
    expect(UpdateOrgRequest.safeParse(body).success).toBe(false);
  });
  it.each([
    ['1-char name', { name: 'a' }],
    ['100-char name', { name: 'a'.repeat(100) }],
    ['63-char slug', { slug: 'a'.repeat(63) }],
    ['name and slug', { name: 'Acme', slug: 'acme' }],
  ])('accepts %s', (_n, body) => {
    expect(UpdateOrgRequest.safeParse(body).success).toBe(true);
  });
});

describe('OrgDto', () => {
  it('parses id, name and slug', () => {
    expect(OrgDto.safeParse({ id: ID, name: 'Acme', slug: 'acme' }).success).toBe(true);
  });
});
