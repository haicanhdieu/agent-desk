import { describe, expect, it } from 'vitest';
import {
  AGENT_AUTO_RESUME_MAX_DEFAULT,
  AGENT_AUTO_RESUME_MAX_MAX,
  AGENT_AUTO_RESUME_MAX_MIN,
  AGENT_IDLE_END_SECONDS_DEFAULT,
  AGENT_IDLE_END_SECONDS_MAX,
  AGENT_IDLE_END_SECONDS_MIN,
  AgentBaseUrl,
  AgentDto,
  AgentModelId,
  AgentConnectionDto,
  AgentModelsDto,
  AGENT_TEST_MESSAGES,
  AgentTestStatus,
  CreateAgentRequest,
  UpdateAgentRequest,
  PutAgentRequest,
  PutCredentialRequest,
} from './agents';
import { AGENT_ACCOUNT_LABEL_MAX, AGENT_KINDS_COMING_SOON, AGENT_NAME_MAX } from '../agent-kinds';

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
      autoResumeMax: 5,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
      accountLabel: null,
      isDefault: true,
      lastTest: null,
      usage: { rules: 0, blockingRuns: 0 },
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
    'https://[1::2::3]',
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
      autoResumeMax: 5,
      credential: { set: false, type: null, updatedAt: null, setBy: null },
      accountLabel: null,
      isDefault: true,
      lastTest: null,
      usage: { rules: 0, blockingRuns: 0 },
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

describe('autoResumeMax', () => {
  it('the bounds are 0 to 10 and the default is 5', () => {
    expect([AGENT_AUTO_RESUME_MAX_MIN, AGENT_AUTO_RESUME_MAX_MAX, AGENT_AUTO_RESUME_MAX_DEFAULT]).toEqual([0, 10, 5]);
  });

  it('is optional on a put and accepts 0 to 10', () => {
    expect(PutAgentRequest.parse(base).autoResumeMax).toBeUndefined();
    for (const v of [0, 5, 10]) expect(PutAgentRequest.parse({ ...base, autoResumeMax: v }).autoResumeMax).toBe(v);
  });

  it('rejects out-of-range values and fractions, with a plain message', () => {
    for (const v of [-1, 11, 2.5]) {
      expect(PutAgentRequest.safeParse({ ...base, autoResumeMax: v }).success).toBe(false);
    }
    for (const v of [-1, 11]) {
      const r = PutAgentRequest.safeParse({ ...base, autoResumeMax: v });
      expect(r.error?.issues.map((i) => [i.path, i.message])).toEqual([
        [['autoResumeMax'], 'Automatic resumes must be between 0 and 10'],
      ]);
    }
  });

  it('AgentDto requires it', () => {
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
      accountLabel: null,
      isDefault: true,
      lastTest: null,
      usage: { rules: 0, blockingRuns: 0 },
    };
    expect(AgentDto.safeParse(dto).success).toBe(false);
    expect(AgentDto.safeParse({ ...dto, autoResumeMax: 5 }).success).toBe(true);
  });
});

const ID = '00000000-0000-4000-8000-000000000001';
const dto = {
  id: ID,
  projectId: ID,
  name: 'Claude - Work',
  provider: 'claude',
  model: 'sonnet',
  baseUrl: null,
  maxTurns: null,
  timeoutSeconds: 86400,
  pausedKeepSeconds: 604800,
  doneKeepSeconds: 86400,
  idleEndSeconds: 1800,
  autoResumeMax: 5,
  credential: { set: false, type: null, updatedAt: null, setBy: null },
  accountLabel: null,
  isDefault: true,
  lastTest: null,
  usage: { rules: 0, blockingRuns: 0 },
};

describe('CreateAgentRequest and UpdateAgentRequest', () => {
  it.each([
    ['name', AGENT_NAME_MAX],
    ['accountLabel', AGENT_ACCOUNT_LABEL_MAX],
  ])('%s accepts 256, refuses 257, empty and spaces, and trims', (field, max) => {
    const make = (v: string) => CreateAgentRequest.safeParse({ provider: 'claude', name: 'n', [field]: v });
    expect(make('a'.repeat(max)).success).toBe(true);
    expect(make('a'.repeat(max + 1)).success).toBe(false);
    expect(make('').success).toBe(false);
    expect(make('   ').success).toBe(false);
    expect(CreateAgentRequest.parse({ provider: 'claude', name: ' x ', accountLabel: ' y ' })).toMatchObject({
      name: 'x',
      accountLabel: 'y',
    });
    expect(UpdateAgentRequest.safeParse({ [field]: 'a'.repeat(max + 1) }).success).toBe(false);
    expect(UpdateAgentRequest.safeParse({ [field]: '   ' }).success).toBe(false);
  });

  it('hostile strings are bounded by length only for name and label, and by the pattern for the model', () => {
    for (const v of ['a; rm -rf /', '$(id)', 'x\ny', 'x\u0000y', 'a'.repeat(61), 'a'.repeat(81)]) {
      expect(CreateAgentRequest.safeParse({ provider: 'claude', name: v }).success).toBe(true);
      expect(CreateAgentRequest.safeParse({ provider: 'claude', name: 'n', accountLabel: v }).success).toBe(true);
    }
    expect(CreateAgentRequest.safeParse({ provider: 'claude', name: 'a'.repeat(10000) }).success).toBe(false);
    for (const v of ['a; rm -rf /', '$(id)', 'x\ny', 'x\u0000y', 'a b', 'a'.repeat(201), 'a'.repeat(10000)]) {
      expect(CreateAgentRequest.safeParse({ provider: 'claude', name: 'n', model: v }).success).toBe(false);
      expect(UpdateAgentRequest.safeParse({ model: v }).success).toBe(false);
    }
  });

  it('refuses every coming-soon id and an unknown provider with the issue on /provider', () => {
    for (const id of [...AGENT_KINDS_COMING_SOON.map((k) => k.id), 'antigravity', 'nope']) {
      const r = CreateAgentRequest.safeParse({ provider: id, name: 'n' });
      expect(r.success).toBe(false);
      expect(r.error?.issues.some((i) => i.path.join('/') === 'provider')).toBe(true);
    }
    for (const id of ['claude', 'codex', 'opencode']) {
      expect(CreateAgentRequest.safeParse({ provider: id, name: 'n' }).success).toBe(true);
    }
  });

  it('create allows an absent model and maxTurns; update allows null label, null maxTurns and an empty model', () => {
    expect(CreateAgentRequest.safeParse({ provider: 'opencode', name: 'n', maxTurns: 5 }).success).toBe(true);
    expect(UpdateAgentRequest.safeParse({ accountLabel: null, maxTurns: null, model: '' }).success).toBe(true);
    expect(UpdateAgentRequest.safeParse({}).success).toBe(true);
  });

  it('refuses provider on update, baseUrl, credential fields and options on both', () => {
    expect(UpdateAgentRequest.safeParse({ provider: 'codex' }).success).toBe(false);
    for (const extra of [
      { baseUrl: 'https://example.com' },
      { type: 'api_key' },
      { credentialType: 'api_key' },
      { value: 'secret' },
      { options: {} },
    ]) {
      expect(CreateAgentRequest.safeParse({ provider: 'claude', name: 'n', ...extra }).success).toBe(false);
      expect(UpdateAgentRequest.safeParse({ name: 'n', ...extra }).success).toBe(false);
    }
  });
});

describe('AgentDto and AgentConnectionDto', () => {
  it('parse a fixture and carry no value or options key', () => {
    const d = AgentDto.parse({ ...dto, lastTest: { status: 'rejected', at: '2026-01-01T00:00:00.000Z' } });
    expect(d.lastTest?.status).toBe('rejected');
    expect(Object.keys(d)).not.toContain('options');
    expect(Object.keys(d.credential)).not.toContain('value');
    const c = AgentConnectionDto.parse({ status: 'no_credential', message: 'm', testedAt: null });
    expect(Object.keys(c)).not.toContain('value');
  });

  it('refuses a bad test status and a missing usage', () => {
    expect(AgentDto.safeParse({ ...dto, lastTest: { status: 'bad', at: '2026-01-01T00:00:00.000Z' } }).success).toBe(
      false,
    );
    expect(AgentDto.safeParse({ ...dto, usage: undefined }).success).toBe(false);
  });

  it('has a non-empty fixed message for every connection status', () => {
    const statuses = [...AgentTestStatus.options, 'no_credential'] as const;
    expect(Object.keys(AGENT_TEST_MESSAGES).sort()).toEqual([...statuses].sort());
    for (const s of statuses) expect(AGENT_TEST_MESSAGES[s].length).toBeGreaterThan(0);
    expect(AGENT_TEST_MESSAGES.ok).toBe('Connected');
  });
});

describe('PutCredentialRequest', () => {
  it('still accepts auth_json with a string value and an optional baseUrl', () => {
    expect(PutCredentialRequest.safeParse({ type: 'auth_json', value: '{}' }).success).toBe(true);
    expect(
      PutCredentialRequest.safeParse({ type: 'auth_json', value: '{}', baseUrl: 'https://example.com' }).success,
    ).toBe(true);
  });
});
