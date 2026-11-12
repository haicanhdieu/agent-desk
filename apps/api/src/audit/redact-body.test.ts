import { describe, expect, it } from 'vitest';
import { redactBody } from './redact-body';

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
