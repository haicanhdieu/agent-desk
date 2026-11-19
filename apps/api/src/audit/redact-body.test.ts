import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { flattenRoutes, routes } from '@agentdesk/contracts';
import { SCRIPT_FIELD_BY_ACTION, redactBody } from './redact-body';

describe('SCRIPT_FIELD_BY_ACTION', () => {
  it('only names existing route keys with the matching method and a body field', () => {
    const flat = flattenRoutes(routes);
    for (const [action, field] of Object.entries(SCRIPT_FIELD_BY_ACTION)) {
      const [method, key] = action.split(' ');
      const def = flat[key ?? ''];
      expect(def, action).toBeDefined();
      expect(def?.method).toBe(method);
      expect(def?.body, action).toBeDefined();
      expect(JSON.stringify(def?.body?.toJSONSchema())).toContain(`"${field}"`);
    }
  });
});

describe('redactBody', () => {
  it('drops secret-looking keys at any depth', () => {
    expect(
      redactBody({
        name: 'n',
        value: 1,
        apiKey: 'a',
        API_KEY: 'a',
        accessToken: 't',
        Authorization: 'x',
        credential: 'c',
        private_key: 'k',
        values: [1],
        nested: [{ clientSecret: 's', keep: 1 }],
      }),
    ).toEqual({ name: 'n', values: [1], nested: [{ keep: 1 }] });
  });
});

describe('redactBody script text', () => {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

  it('replaces body with { sha256, bytes } for setupScript.put and keeps other fields', () => {
    const body = 'echo 🚀\r\n';
    const out = redactBody({ body, note: 'n', baseVersion: 3 }, 'PUT setupScript.put');
    expect(out).toEqual({ sha256: sha(body), bytes: Buffer.byteLength(body, 'utf8'), note: 'n', baseVersion: 3 });
    expect(out).not.toHaveProperty('body');
  });

  it('replaces script (not body) for setupTests.create', () => {
    const out = redactBody({ script: 'make test', other: 1 }, 'POST setupTests.create');
    expect(out).toEqual({ sha256: sha('make test'), bytes: 9, other: 1 });
  });

  it.each(['POST rules.create', 'PATCH rules.update'])('replaces prompt with { sha256, bytes } for %s', (action) => {
    const prompt = 'use key sk-LEAKED 🚀';
    const out = redactBody({ kind: 'prompt', command: 'c', prompt }, action);
    expect(out).toEqual({
      kind: 'prompt',
      command: 'c',
      sha256: sha(prompt),
      bytes: Buffer.byteLength(prompt, 'utf8'),
    });
    expect(JSON.stringify(out)).not.toContain('sk-LEAKED');
  });

  it('leaves body untouched on other actions', () => {
    expect(redactBody({ body: 'x' }, 'PUT skills.put')).toEqual({ body: 'x' });
    expect(redactBody({ body: 'x' })).toEqual({ body: 'x' });
  });

  it('drops the field entirely when it is not a string, never keeping raw text', () => {
    expect(redactBody({ body: { a: 'secret' } }, 'PUT setupScript.put')).toEqual({});
  });
});

describe('redactBody credential with an address', () => {
  it('a credential body with an address keeps baseUrl and drops value', () => {
    expect(
      redactBody(
        { type: 'api_key', value: 'sk-secret', baseUrl: 'https://gw.example.com/anthropic' },
        'PUT agents.putCredential',
      ),
    ).toEqual({ type: 'api_key', baseUrl: 'https://gw.example.com/anthropic' });
  });
});
