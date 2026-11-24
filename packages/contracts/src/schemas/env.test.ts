import { describe, expect, it } from 'vitest';
import {
  CreateEnvSecretRequest,
  CreateEnvVarRequest,
  ENV_CAP_DETAIL_PREFIX,
  ENV_MAX_TOTAL_BYTES,
  ENV_SIZE_DETAIL_PREFIX,
  ENV_NAME_MAX,
  ENV_VALUE_MAX_BYTES,
  EnvEntryDto,
  EnvListQuery,
  EnvName,
  EnvSecretValue,
  EnvVarValue,
  RESERVED_ENV_NAMES,
  RESERVED_ENV_PREFIXES,
  SECRET_VALUE_MIN_LENGTH,
  UpdateEnvSecretRequest,
  UpdateEnvVarRequest,
  isReservedEnvName,
} from '../index';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;
const bytes = (n: number) => 'a'.repeat(n);

describe('env limits', () => {
  it('pins the constants', () => {
    expect(ENV_NAME_MAX).toBe(128);
    expect(ENV_VALUE_MAX_BYTES).toBe(8192);
    expect(ENV_MAX_TOTAL_BYTES).toBe(262144);
    expect(SECRET_VALUE_MIN_LENGTH).toBe(6);
  });

  it('pins the start of the two 409 details the web tells apart', () => {
    expect(ENV_CAP_DETAIL_PREFIX).toBe('This project already has the maximum of ');
    expect(ENV_SIZE_DETAIL_PREFIX).toBe('Names and values together cannot exceed ');
  });
});

describe('EnvName', () => {
  it.each([
    ['A'.repeat(128), true],
    ['A'.repeat(129), false],
    ['1A', false],
    ['', false],
    ['A B', false],
    ['MY-VAR', false],
    [' DB', false],
    ['NAMÉ', false],
    ['_A1', true],
    ['db_host', true],
    ['DB_HOST', true],
    ['path', true],
  ])('%j -> %s', (name, expected) => {
    expect(ok(EnvName, name)).toBe(expected);
  });

  it.each([...RESERVED_ENV_NAMES])('refuses reserved name %s', (name) => {
    expect(ok(EnvName, name)).toBe(false);
    expect(isReservedEnvName(name)).toBe(true);
  });

  it.each([...RESERVED_ENV_PREFIXES])('refuses prefix %s', (prefix) => {
    expect(ok(EnvName, `${prefix}X`)).toBe(false);
    expect(isReservedEnvName(`${prefix}X`)).toBe(true);
  });

  it.each(['PATHS', 'MY_RUN_ID', 'MY_PATH', 'GITHUB_TOKEN2', 'BASH', 'LDX', 'RUNNER', 'AGENTS'])(
    'accepts near-miss %s',
    (name) => {
      expect(ok(EnvName, name)).toBe(true);
      expect(isReservedEnvName(name)).toBe(false);
    },
  );

  it('refuses AGENTDESK_X and lowercase is not reserved (case-sensitive)', () => {
    expect(ok(EnvName, 'AGENTDESK_X')).toBe(false);
    expect(ok(EnvName, 'path')).toBe(true);
  });

  it('says why GITHUB_TOKEN is refused', () => {
    const r = EnvName.safeParse('GITHUB_TOKEN');
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('GITHUB_TOKEN is reserved: Agent Desk sets it for every run.');
  });
});

describe('EnvName messages', () => {
  const msgs = (v: string) => EnvName.safeParse(v).error?.issues.map((i) => i.message);

  it('asks for a name when empty', () => {
    expect(msgs('')?.[0]).toBe('Enter a name.');
  });

  it('explains the allowed characters', () => {
    expect(msgs('1A')).toEqual(['Use letters, digits and _, and do not start with a digit.']);
    expect(msgs('A-B')).toEqual(['Use letters, digits and _, and do not start with a digit.']);
  });

  it('explains the length limit', () => {
    expect(msgs('A'.repeat(129))).toEqual(['Use 128 characters or fewer.']);
  });
});

describe('EnvVarValue', () => {
  it.each([
    ['empty', '', true],
    ['8192 bytes', bytes(8192), true],
    ['8193 bytes', bytes(8193), false],
    ['multibyte 4096 chars = 8192 bytes', 'é'.repeat(4096), true],
    ['multibyte 4097 chars = 8194 bytes', 'é'.repeat(4097), false],
    ['LF', 'a\nb', false],
    ['CR', 'a\rb', false],
    ['CRLF', 'a\r\nb', false],
    ['NUL', 'a\u0000b', false],
  ])('%s', (_label, value, expected) => {
    expect(ok(EnvVarValue, value)).toBe(expected);
  });

  it('explains a line break', () => {
    expect(EnvVarValue.safeParse('a\nb').error?.issues[0]?.message).toBe('A value cannot contain a line break.');
  });

  it('explains a value over 8 KiB', () => {
    expect(EnvVarValue.safeParse(bytes(8193)).error?.issues[0]?.message).toBe('Use 8 KiB or less.');
  });
});

describe('EnvSecretValue', () => {
  it.each([
    ['empty', '', false],
    ['5 chars', '12345', false],
    ['6 chars', '123456', true],
    ['8192 bytes', bytes(8192), true],
    ['8193 bytes', bytes(8193), false],
    ['line break', 'abcdef\nx', false],
  ])('%s', (_label, value, expected) => {
    expect(ok(EnvSecretValue, value)).toBe(expected);
  });

  it('asks for a value when the secret is empty', () => {
    expect(EnvSecretValue.safeParse('').error?.issues.map((i) => i.message)).toEqual(['Enter a value.']);
  });

  it.each(['1', '12345'])('explains a short value %j', (value) => {
    expect(EnvSecretValue.safeParse(value).error?.issues.map((i) => i.message)).toEqual(['Too short to hide in logs.']);
  });
});

describe('EnvListQuery', () => {
  it.each([
    [{}, false],
    [{ kind: 'other' }, false],
    [{ kind: 'plain' }, true],
    [{ kind: 'secret', pageSize: '100' }, true],
    [{ kind: 'secret', pageSize: '101' }, false],
  ])('%j -> %s', (q, expected) => {
    expect(ok(EnvListQuery, q)).toBe(expected);
  });
});

describe('request bodies', () => {
  it('create var and secret take name and value', () => {
    expect(ok(CreateEnvVarRequest, { name: 'DB_HOST', value: '' })).toBe(true);
    expect(ok(CreateEnvVarRequest, { name: 'PATH', value: 'x' })).toBe(false);
    expect(ok(CreateEnvVarRequest, { name: 'DB_HOST' })).toBe(false);
    expect(ok(CreateEnvSecretRequest, { name: 'DB_PASS', value: '123456' })).toBe(true);
    expect(ok(CreateEnvSecretRequest, { name: 'DB_PASS', value: '12345' })).toBe(false);
  });

  it('update takes only value', () => {
    expect(ok(UpdateEnvVarRequest, { value: '' })).toBe(true);
    expect(ok(UpdateEnvVarRequest, {})).toBe(false);
    expect(ok(UpdateEnvSecretRequest, { value: '123456' })).toBe(true);
    expect(ok(UpdateEnvSecretRequest, { value: '1' })).toBe(false);
  });
});

describe('EnvEntryDto', () => {
  const base = { name: 'A', kind: 'secret', updatedAt: '2026-11-23T00:00:00.000Z', updatedBy: 'ann' };
  it('accepts a null value and a string value', () => {
    expect(ok(EnvEntryDto, { ...base, value: null })).toBe(true);
    expect(ok(EnvEntryDto, { ...base, kind: 'plain', value: 'x' })).toBe(true);
  });
  it('refuses an unknown kind', () => {
    expect(ok(EnvEntryDto, { ...base, kind: 'other', value: null })).toBe(false);
  });
});
