import { describe, expect, it } from 'vitest';
import {
  credentialMatchesAddress,
  credentialSecretData,
  parseCredentialSecret,
} from '../src/secrets/credential-secret';

describe('credentialMatchesAddress', () => {
  it('treats null, undefined and an empty address as the default address', () => {
    for (const stored of [null, undefined, '']) {
      for (const agent of [null, undefined, '']) {
        expect(credentialMatchesAddress({ baseUrl: stored }, agent)).toBe(true);
      }
    }
  });

  it('matches a custom address only by exact equality', () => {
    expect(credentialMatchesAddress({ baseUrl: 'https://gw.example.com' }, 'https://gw.example.com')).toBe(true);
    expect(credentialMatchesAddress({ baseUrl: 'https://gw.example.com' }, 'https://gw.example.com/')).toBe(false);
    expect(credentialMatchesAddress({ baseUrl: 'https://gw.example.com' }, 'https://other.example.com')).toBe(false);
  });

  it('a legacy secret without an address works only with the default address', () => {
    expect(credentialMatchesAddress({}, null)).toBe(true);
    expect(credentialMatchesAddress({}, 'https://gw.example.com')).toBe(false);
  });

  it('a custom-address secret does not work with the default address', () => {
    expect(credentialMatchesAddress({ baseUrl: 'https://gw.example.com' }, null)).toBe(false);
  });
});

describe('credential secret payload', () => {
  it('writes baseUrl only for a custom address and parses it back', () => {
    expect(credentialSecretData('api_key', 'v', null)).toEqual({ type: 'api_key', value: 'v' });
    const data = credentialSecretData('oauth_token', 'v', 'https://gw.example.com');
    expect(data).toEqual({ type: 'oauth_token', value: 'v', baseUrl: 'https://gw.example.com' });
    expect(parseCredentialSecret(data)).toEqual({ type: 'oauth_token', value: 'v', baseUrl: 'https://gw.example.com' });
  });

  it('parses a legacy secret as the default address and rejects unusable ones', () => {
    expect(parseCredentialSecret({ type: 'api_key', value: 'v' })).toEqual({
      type: 'api_key',
      value: 'v',
      baseUrl: null,
    });
    expect(parseCredentialSecret(null)).toBeNull();
    expect(parseCredentialSecret({ type: 'bogus', value: 'v' })).toBeNull();
    expect(parseCredentialSecret({ type: 'api_key', value: '' })).toBeNull();
  });
});
