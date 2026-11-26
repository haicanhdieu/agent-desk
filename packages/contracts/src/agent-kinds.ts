import type { AgentKind, CredentialType } from './enums';

export const AGENT_NAME_MAX = 256;
export const AGENT_ACCOUNT_LABEL_MAX = 256;

export interface AgentKindCapability {
  label: string;
  logo: string;
  credentialTypes: { type: CredentialType; label: string; valueLabel: string; help: string }[];
  baseUrl: { help: string; requiredFor: CredentialType[] } | null;
  modelHelp: string;
  supportsMaxTurns: boolean;
  credentialOptional: boolean;
  modelOptional: boolean;
  /** The standard model names; each adapter in packages/core serves the same list (pinned by a parity test). */
  builtinModels: { id: string; label: string }[];
}

const API_KEY_HELP = 'Billed per token. Usage cost shows on each run.';

export const AGENT_KIND_CAPABILITIES: Record<AgentKind, AgentKindCapability> = {
  claude: {
    label: 'Claude Code',
    logo: 'claude',
    credentialTypes: [
      {
        type: 'oauth_token',
        label: 'Subscription token',
        valueLabel: 'Subscription token',
        help: 'Paste the token from your Claude subscription. It is saved write-only and never shown again.',
      },
      { type: 'api_key', label: 'API key', valueLabel: 'API key', help: API_KEY_HELP },
    ],
    baseUrl: {
      help: 'Optional. Leave empty for Anthropic’s default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only. Changing it needs the credential again.',
      requiredFor: [],
    },
    modelHelp: 'Sent to Claude Code exactly as typed. Rules that don’t name a model use this one.',
    supportsMaxTurns: true,
    credentialOptional: false,
    modelOptional: false,
    builtinModels: [
      { id: 'opus', label: 'opus' },
      { id: 'sonnet', label: 'sonnet' },
      { id: 'haiku', label: 'haiku' },
    ],
  },
  codex: {
    label: 'OpenAI Codex',
    logo: 'codex',
    credentialTypes: [
      {
        type: 'auth_json',
        label: 'Sign-in file (auth.json)',
        valueLabel: 'auth.json contents',
        help: 'Paste the contents of the auth.json file Codex CLI writes when you sign in. It is saved write-only and never shown again.',
      },
      { type: 'api_key', label: 'API key', valueLabel: 'API key', help: API_KEY_HELP },
    ],
    baseUrl: null,
    modelHelp: 'Rules that don’t name a model use this one.',
    supportsMaxTurns: false,
    credentialOptional: false,
    modelOptional: false,
    builtinModels: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'gpt-5.5', label: 'GPT-5.5 (API key only)' },
    ],
  },
  opencode: {
    label: 'OpenCode',
    logo: 'opencode',
    credentialTypes: [
      {
        type: 'auth_json',
        label: 'Credentials file',
        valueLabel: 'Credentials file',
        help: 'Paste the file from `opencode auth export <provider>`, for example `opencode auth export anthropic`. It contains secrets: it is stored write-only and never shown again.',
      },
      {
        type: 'api_key',
        label: 'API endpoint and key',
        valueLabel: 'API key',
        help: API_KEY_HELP,
      },
    ],
    baseUrl: {
      help: 'Must be an OpenAI-compatible chat-completions endpoint on public https. localhost and endpoints that only offer /v1/responses are not supported.',
      requiredFor: ['api_key'],
    },
    modelHelp: "Use provider/model, for example anthropic/claude-sonnet-4-5. Leave it empty to use OpenCode's default.",
    supportsMaxTurns: false,
    credentialOptional: true,
    modelOptional: true,
    builtinModels: [
      { id: 'opencode/big-pickle', label: 'Big Pickle (free)' },
      { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash (free)' },
      { id: 'opencode/qwen4-max-free', label: 'Qwen4 Max (free)' },
      { id: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL (free)' },
    ],
  },
};

/** The folder every agent shares; searched after the agent's own folder. */
export const SKILL_FOLDER_GENERIC = '.agents/skills';

/** The project folder each agent's CLI keeps its own skills in. */
const AGENT_SKILL_FOLDER: Record<AgentKind, string> = {
  claude: '.claude/skills',
  codex: '.agents/skills',
  opencode: '.opencode/skills',
};

/**
 * The repo folders the Skills page searches for an agent kind, in precedence order: the agent's own folder, then
 * `.agents/skills`. When a skill name is in both, the first folder wins.
 */
export function skillFolders(kind: AgentKind): string[] {
  return [...new Set([AGENT_SKILL_FOLDER[kind], SKILL_FOLDER_GENERIC])];
}

export const AGENT_KINDS_COMING_SOON: readonly { id: string; label: string; logo: string }[] = [
  { id: 'gemini-cli', label: 'Gemini CLI', logo: 'gemini-cli' },
  { id: 'github-copilot-cli', label: 'GitHub Copilot CLI', logo: 'github-copilot-cli' },
  { id: 'cursor', label: 'Cursor', logo: 'cursor' },
  { id: 'amp', label: 'Amp', logo: 'amp' },
  { id: 'aider', label: 'Aider', logo: 'aider' },
  { id: 'cline', label: 'Cline', logo: 'cline' },
  { id: 'goose', label: 'Goose', logo: 'goose' },
  { id: 'qwen-code', label: 'Qwen Code', logo: 'qwen-code' },
  { id: 'kiro', label: 'Kiro', logo: 'kiro' },
  { id: 'google-antigravity', label: 'Google Antigravity', logo: 'google-antigravity' },
];
