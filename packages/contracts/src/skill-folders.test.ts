import { describe, expect, it } from 'vitest';
import { SKILL_FOLDER_GENERIC, skillFolders } from './agent-kinds';
import { AgentKind } from './enums';

describe('skillFolders', () => {
  it.each([
    ['claude', ['.claude/skills']],
    ['codex', ['.agents/skills']],
    ['opencode', ['.opencode/skills', '.agents/skills']],
  ] as const)('%s: its own folder first, then the generic one, with no repeat', (kind, folders) => {
    expect(skillFolders(kind)).toEqual(folders);
  });

  it('Claude Code never reads .agents/skills, so Claude does not search it', () => {
    expect(skillFolders('claude')).not.toContain(SKILL_FOLDER_GENERIC);
  });

  it('every other kind searches the generic folder last', () => {
    for (const kind of AgentKind.options.filter((k) => k !== 'claude'))
      expect(skillFolders(kind).at(-1)).toBe(SKILL_FOLDER_GENERIC);
  });
});
