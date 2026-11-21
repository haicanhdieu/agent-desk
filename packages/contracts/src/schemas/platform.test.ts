import { describe, expect, it } from 'vitest';
import { CreateOrgRequest, PlatformMemberDto, PlatformRoleDto } from './platform';

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
