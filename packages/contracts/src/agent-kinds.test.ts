import { describe, expect, it } from 'vitest';
import { AgentKind, CredentialType } from './enums';
import {
  AGENT_ACCOUNT_LABEL_MAX,
  AGENT_KIND_CAPABILITIES,
  AGENT_KINDS_COMING_SOON,
  AGENT_NAME_MAX,
} from './agent-kinds';

const COMING_SOON_LABELS = [
  'Gemini CLI',
  'GitHub Copilot CLI',
  'Cursor',
  'Amp',
  'Aider',
  'Cline',
  'Goose',
  'Qwen Code',
  'Kiro',
  'Google Antigravity',
];

const texts = (kind: AgentKind): string[] => {
  const row = AGENT_KIND_CAPABILITIES[kind];
  return [
    row.label,
    row.logo,
    row.modelHelp,
    row.baseUrl?.help ?? '',
    ...row.credentialTypes.flatMap((c) => [c.label, c.valueLabel, c.help]),
  ];
};

describe('agent kinds', () => {
  it('every runnable kind has a capability row', () => {
    for (const kind of AgentKind.options) expect(AGENT_KIND_CAPABILITIES[kind]).toBeDefined();
    expect(Object.keys(AGENT_KIND_CAPABILITIES).sort()).toEqual([...AgentKind.options].sort());
    expect(AGENT_NAME_MAX).toBe(256);
    expect(AGENT_ACCOUNT_LABEL_MAX).toBe(256);
  });

  it('lists the ten coming-soon kinds', () => {
    expect(AGENT_KINDS_COMING_SOON.map((k) => k.label)).toEqual(COMING_SOON_LABELS);
    for (const k of AGENT_KINDS_COMING_SOON) expect(k.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it.each(COMING_SOON_LABELS)(
    '%s is not an AgentKind value, has no capability row, and has a non-empty logo key',
    (label) => {
      const entry = AGENT_KINDS_COMING_SOON.find((k) => k.label === label);
      expect(entry).toBeDefined();
      expect(AgentKind.safeParse(entry?.id).success).toBe(false);
      expect(Object.keys(AGENT_KIND_CAPABILITIES)).not.toContain(entry?.id);
      expect(entry?.logo.length).toBeGreaterThan(0);
    },
  );

  it('logo keys are plain asset keys (no slash, dot or markup)', () => {
    const logos = [
      ...Object.values(AGENT_KIND_CAPABILITIES).map((r) => r.logo),
      ...AGENT_KINDS_COMING_SOON.map((k) => k.logo),
    ];
    for (const logo of logos) expect(logo).toMatch(/^[a-z0-9-]+$/);
  });

  it('claude offers oauth_token and api_key and an optional address; codex offers auth_json and api_key and no address; opencode offers auth_json and api_key, baseUrl.requiredFor is [api_key], and it has no modelProviders', () => {
    const types = (k: AgentKind) => AGENT_KIND_CAPABILITIES[k].credentialTypes.map((c) => c.type);
    expect(types('claude')).toEqual(['oauth_token', 'api_key']);
    expect(AGENT_KIND_CAPABILITIES.claude.baseUrl).not.toBeNull();
    expect(types('codex')).toEqual(['auth_json', 'api_key']);
    expect(AGENT_KIND_CAPABILITIES.codex.baseUrl).toBeNull();
    expect(types('opencode')).toEqual(['auth_json', 'api_key']);
    expect(AGENT_KIND_CAPABILITIES.opencode.baseUrl?.requiredFor).toEqual(['api_key']);
    expect('modelProviders' in AGENT_KIND_CAPABILITIES.opencode).toBe(false);
    expect(AGENT_KIND_CAPABILITIES.codex.credentialTypes[0]).toMatchObject({
      label: 'Sign-in file (auth.json)',
      valueLabel: 'auth.json contents',
    });
    expect(AGENT_KIND_CAPABILITIES.opencode.credentialTypes[0]).toMatchObject({
      label: 'Credentials file',
      valueLabel: 'Credentials file',
    });
    expect(AGENT_KIND_CAPABILITIES.opencode.credentialTypes[0]?.help).toContain('opencode auth export');
    expect(AGENT_KIND_CAPABILITIES.opencode.credentialTypes[1]).toMatchObject({
      label: 'API endpoint and key',
      valueLabel: 'API key',
    });
    expect(AGENT_KIND_CAPABILITIES.opencode.modelHelp).toBe(
      "Use provider/model, for example anthropic/claude-sonnet-4-5. Leave it empty to use OpenCode's default.",
    );
    expect(AGENT_KIND_CAPABILITIES.claude.label).toBe('Claude Code');
    expect(AGENT_KIND_CAPABILITIES.codex.label).toBe('OpenAI Codex');
    expect(AGENT_KIND_CAPABILITIES.opencode.label).toBe('OpenCode');
  });

  it('every row has credentialOptional and modelOptional; only opencode has them true; requiredFor never names a type the kind does not list', () => {
    for (const kind of AgentKind.options) {
      const row = AGENT_KIND_CAPABILITIES[kind];
      expect(typeof row.credentialOptional).toBe('boolean');
      expect(typeof row.modelOptional).toBe('boolean');
      expect(row.credentialOptional).toBe(kind === 'opencode');
      expect(row.modelOptional).toBe(kind === 'opencode');
      const listed = row.credentialTypes.map((c) => c.type);
      for (const t of row.baseUrl?.requiredFor ?? []) {
        expect(CredentialType.options).toContain(t);
        expect(listed).toContain(t);
      }
    }
    expect(AGENT_KIND_CAPABILITIES.claude.baseUrl?.requiredFor).toEqual([]);
    expect(AGENT_KIND_CAPABILITIES.codex.baseUrl).toBeNull();
  });

  it.each(['codex', 'opencode'] as const)('no text of the %s row contains ANTHROPIC_BASE_URL or "Claude"', (kind) => {
    for (const t of texts(kind)) {
      expect(t).not.toContain('ANTHROPIC_BASE_URL');
      expect(t).not.toContain('Claude');
    }
  });

  it('only claude supportsMaxTurns', () => {
    for (const kind of AgentKind.options) {
      expect(AGENT_KIND_CAPABILITIES[kind].supportsMaxTurns).toBe(kind === 'claude');
    }
  });

  it('antigravity is a coming-soon id with no capability row, opencode is an AgentKind and not coming-soon', () => {
    const ids = AGENT_KINDS_COMING_SOON.map((k) => k.id);
    expect(ids).toContain('google-antigravity');
    expect(ids).not.toContain('opencode');
    expect(AgentKind.safeParse('opencode').success).toBe(true);
  });

  it('AgentKind.safeParse refuses each coming-soon id and an unknown value', () => {
    for (const k of AGENT_KINDS_COMING_SOON) expect(AgentKind.safeParse(k.id).success).toBe(false);
    expect(AgentKind.safeParse('antigravity').success).toBe(false);
    expect(AgentKind.safeParse('nope').success).toBe(false);
  });
});
