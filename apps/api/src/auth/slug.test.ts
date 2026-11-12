import { describe, expect, it } from 'vitest';
import { slugFromHandle } from './slug';

describe('slugFromHandle', () => {
  it('lowercases and replaces invalid characters', async () => {
    expect(await slugFromHandle('Minh.Nguyen', async () => false)).toBe('minh-nguyen');
  });

  it('suffixes -2, -3 on collision', async () => {
    const taken = new Set(['alice', 'alice-2']);
    expect(await slugFromHandle('alice', async (s) => taken.has(s))).toBe('alice-3');
    expect(await slugFromHandle('bob', async (s) => taken.has(s))).toBe('bob');
    expect(await slugFromHandle('alice', async (s) => s === 'alice')).toBe('alice-2');
  });

  it('never returns an empty slug', async () => {
    expect(await slugFromHandle('...', async () => false)).toBe('user');
  });
});
