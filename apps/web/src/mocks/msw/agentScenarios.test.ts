import { describe, expect, it } from 'vitest';
import { parseAgentScenario } from './agentScenarios';

describe('parseAgentScenario', () => {
  it('returns a known scenario name', () => {
    expect(parseAgentScenario('manyAgents')).toBe('manyAgents');
    expect(parseAgentScenario('listError')).toBe('listError');
  });

  it('ignores a missing or unknown name', () => {
    expect(parseAgentScenario(null)).toBeUndefined();
    expect(parseAgentScenario('nonsense')).toBeUndefined();
  });
});
