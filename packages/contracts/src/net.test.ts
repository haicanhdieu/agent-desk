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
