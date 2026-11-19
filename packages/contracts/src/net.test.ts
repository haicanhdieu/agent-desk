import { describe, expect, it } from 'vitest';
import { isBlockedIp } from './net';

describe('isBlockedIp', () => {
  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::7f00:1',
    '::10.0.0.1',
    '64:ff9b::7f00:1',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700::1111',
    'gateway.harbor-labs.com',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '::808:808',
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('isBlockedIp malformed input', () => {
  it.each([
    '',
    '1.2.3',
    '1.2.3.4.5',
    '1.2.3.x',
    '1.2.3.1234',
    '1.2.3.256',
    '::1.2.3.256',
    '::1.2.3',
    '1::2::3',
    'gggg::1',
    '1::g',
    '1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7::8',
    '12345::1',
  ])('treats %s as not an IP, so not blocked', (input) => {
    expect(isBlockedIp(input)).toBe(false);
  });

  it('judges a fully written 8-group IPv6 address', () => {
    expect(isBlockedIp('fe80:0:0:0:0:0:0:1')).toBe(true);
    expect(isBlockedIp('2606:4700:0:0:0:0:0:1111')).toBe(false);
  });

  it('accepts a compressed address with a trailing ::', () => {
    expect(isBlockedIp('fc00::')).toBe(true);
    expect(isBlockedIp('2606:4700::')).toBe(false);
  });
});
