import { describe, expect, it } from 'vitest';
import {
  AGENT_IDLE_END_SECONDS_DEFAULT,
  AGENT_IDLE_END_SECONDS_MAX,
  AGENT_IDLE_END_SECONDS_MIN,
  AgentBaseUrl,
  AgentDto,
  AgentModelId,
  AgentModelsDto,
  PutAgentRequest,
  PutCredentialRequest,
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
      baseUrl: null,
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

describe('AgentModelId', () => {
  it.each([
    'opus',
    'claude-sonnet-4-5-20250929',
    'sonnet[1m]',
    'vendor/model',
    'arn:aws:bedrock:us-east-1:1:x',
    '9model',
    'a',
    'a'.repeat(200),
  ])('accepts %s', (v) => {
    expect(AgentModelId.safeParse(v).success).toBe(true);
  });

  it('trims surrounding spaces', () => {
    expect(AgentModelId.parse('  my-model-1  ')).toBe('my-model-1');
  });

  it.each(['', 'a'.repeat(201), 'my model', 'a\tb', '-opus', '.opus'])('rejects %j with the one model message', (v) => {
    const r = AgentModelId.safeParse(v);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      'Use 1 to 200 letters, digits or . _ : / @ [ ] + -, starting with a letter or digit.',
    ]);
  });
});

describe('AgentBaseUrl', () => {
  it.each([
    'https://gateway.harbor-labs.com',
    'https://gateway.harbor-labs.com/v1/anthropic',
    'https://gateway.harbor-labs.com/' + 'a'.repeat(2016),
    'https://gw_1.example.com',
    'https://gateway.example.com:8443/v1',
    'https://[2606:4700::1111]:8443/v1',
  ])('accepts %s', (v) => {
    expect(AgentBaseUrl.safeParse(v).success).toBe(true);
  });

  it.each([
    'http://gateway.harbor-labs.com',
    'https://user:pass@gateway.harbor-labs.com',
    'https://gateway.harbor-labs.com/v1?key=1',
    'https://gateway.harbor-labs.com/v1#top',
    'https://gateway.harbor-labs.com/' + 'a'.repeat(2017),
    'https://localhost',
    'https://app.localhost',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://192.168.1.1',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://100.64.0.1',
    'https://0.0.0.0',
    'https://2130706433',
    'https://0x7f.0.0.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'not a url',
    'https://localhost.',
    'https://app.localhost.',
    'https://localhost%2e',
    'HTTPS://gateway.harbor-labs.com',
    'https:gateway.harbor-labs.com',
    'https:\\\\gateway.harbor-labs.com',
    'https://gateway.harbor-labs.com\\v1',
    'https://gateway.harbor-labs.com/v\n1',
    'https://gateway.harbor-\tlabs.com',
    'https://gateway.harbor-labs.com\u0000',
    'https://gateway.harbor-labs.com/a\u0001b',
    'https://gateway.harbor-labs.com/a\u007fb',
    'https://bücher.example',
    'https://gw~1.example.com',
    'https://a+b.example',
    'https://gw%41.example.com',
    'https://a!b.example',
    'https://gw.example.com:',
    'https://gw.example.com:/v1',
    'https://gateway.harbor-labs.com/café',
  ])('rejects %s with the one address message', (v) => {
    const r = AgentBaseUrl.safeParse(v);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      'Use a public https address with no username, password, query or fragment, up to 2048 characters.',
    ]);
  });
});

describe('agent model and address contracts', () => {
  it('PutCredentialRequest takes an absent, null or valid baseUrl and fails an invalid one at baseUrl', () => {
    const c = { type: 'api_key', value: 'k' };
    expect(PutCredentialRequest.safeParse(c).success).toBe(true);
    expect(PutCredentialRequest.safeParse({ ...c, baseUrl: null }).success).toBe(true);
    expect(PutCredentialRequest.safeParse({ ...c, baseUrl: 'https://gateway.harbor-labs.com' }).success).toBe(true);
    const bad = PutCredentialRequest.safeParse({ ...c, baseUrl: 'http://x' });
    expect(bad.error?.issues[0]?.path).toEqual(['baseUrl']);
  });

  it('PutAgentRequest rejects a model with a space at model', () => {
    const r = PutAgentRequest.safeParse({ model: 'my model', timeoutSeconds: 60 });
    expect(r.error?.issues[0]?.path).toEqual(['model']);
  });

  it('AgentDto parses with baseUrl null and provider claude', () => {
    const r = AgentDto.safeParse({
      id: '0190a7c2-0000-7000-8000-000000000001',
      projectId: '0190a7c2-0000-7000-8000-000000000002',
      name: 'a',
      provider: 'claude',
      model: 'sonnet',
      baseUrl: null,
      maxTurns: null,
      timeoutSeconds: 60,
      pausedKeepSeconds: 3600,
      doneKeepSeconds: 0,
      idleEndSeconds: 300,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
    });
    expect(r.success).toBe(true);
  });

  it('AgentModelsDto parses a builtin list with a reason', () => {
    expect(
      AgentModelsDto.safeParse({ source: 'builtin', reason: 'disabled', models: [{ id: 'opus', label: 'opus' }] })
        .success,
    ).toBe(true);
  });
});
