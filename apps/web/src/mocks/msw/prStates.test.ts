import { describe, expect, it } from 'vitest';
import { prStateItems } from './prStates';

const states = { '148': 'merged', '133': 'open', '104': 'draft', '108': 'closed' } as const;

describe('prStateItems', () => {
  it('answers known refs in request order and leaves out unknown refs', () => {
    expect(prStateItems(states, ['148', '999', '133'], false)).toEqual([
      { ref: '148', prState: 'merged' },
      { ref: '133', prState: 'open' },
    ]);
  });
  it('with partial leaves out draft and closed', () => {
    expect(prStateItems(states, ['104', '148', '108', '133'], true)).toEqual([
      { ref: '148', prState: 'merged' },
      { ref: '133', prState: 'open' },
    ]);
  });
});
