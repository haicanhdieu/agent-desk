import { describe, expect, it } from 'vitest';
import { safeInstallUrl } from './location';

describe('safeInstallUrl', () => {
  it.each([
    [
      'https://github.com/apps/agent-desk/installations/new',
      'production',
      'https://github.com/apps/agent-desk/installations/new',
    ],
    ['http://localhost:3000/install', 'production', null],
    ['http://localhost:3000/install', 'mock', 'http://localhost:3000/install'],
    ['http://localhost:3000/install', 'development', 'http://localhost:3000/install'],
    ['javascript:alert(1)', 'development', null],
    ['data:text/html,<script>alert(1)</script>', 'production', null],
    ['/install', 'production', null],
    ['//evil.example/install', 'production', null],
    ['', 'production', null],
  ])('%s in %s → %s', (url, mode, expected) => {
    expect(safeInstallUrl(url, mode)).toBe(expected);
  });
});
