import { describe, expect, it } from 'vitest';
import { toInviterDto } from './inviter';

describe('toInviterDto', () => {
  it.each([
    [
      { name: 'Ada Lovelace', handle: 'ada' },
      { name: 'Ada Lovelace', handle: 'ada' },
    ],
    [
      { name: '  ', handle: 'ada' },
      { name: 'ada', handle: 'ada' },
    ],
    [
      { name: '', handle: 'ada' },
      { name: 'ada', handle: 'ada' },
    ],
    [
      { name: ' Bob ', handle: 'bob' },
      { name: 'Bob', handle: 'bob' },
    ],
    [
      { name: '', handle: null },
      { name: '', handle: '' },
    ],
    [null, null],
    [undefined, null],
  ])('maps %j to %j', (row, expected) => {
    expect(toInviterDto(row)).toEqual(expected);
  });
});
