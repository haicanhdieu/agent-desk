import { describe, expect, it } from 'vitest';
import {
  AGENT_IDLE_END_SECONDS_DEFAULT,
  AGENT_IDLE_END_SECONDS_MAX,
  AGENT_IDLE_END_SECONDS_MIN,
  AgentDto,
  PutAgentRequest,
} from './agents';

const base = { model: 'm', timeoutSeconds: 60 };

describe('PutAgentRequest idle end', () => {
  it('the bounds are 5 minutes to 7 days and the default is 30 minutes', () => {
    expect([AGENT_IDLE_END_SECONDS_MIN, AGENT_IDLE_END_SECONDS_MAX, AGENT_IDLE_END_SECONDS_DEFAULT]).toEqual([
      300, 604800, 1800,
    ]);
  });

  it('accepts the bounds, any value between them, and an absent value', () => {
    for (const idleEndSeconds of [300, 1234, 604800]) {
      expect(PutAgentRequest.safeParse({ ...base, idleEndSeconds }).success).toBe(true);
    }
    expect(PutAgentRequest.safeParse(base).success).toBe(true);
  });

  it('rejects under 5 minutes with a plain message', () => {
    const r = PutAgentRequest.safeParse({ ...base, idleEndSeconds: 299 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Idle runs must end after between 5 minutes and 7 days');
  });

  it('rejects over 7 days and fractions', () => {
    expect(PutAgentRequest.safeParse({ ...base, idleEndSeconds: 604801 }).success).toBe(false);
    expect(PutAgentRequest.safeParse({ ...base, idleEndSeconds: 400.5 }).success).toBe(false);
  });
});

describe('AgentDto idle end', () => {
  it('carries idleEndSeconds', () => {
    const dto = {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      name: 'Claude',
      provider: 'claude',
      model: 'opus',
      maxTurns: null,
      timeoutSeconds: 60,
      pausedKeepSeconds: 3600,
      doneKeepSeconds: 0,
      idleEndSeconds: 900,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
    };
    expect(AgentDto.parse(dto).idleEndSeconds).toBe(900);
  });
});
