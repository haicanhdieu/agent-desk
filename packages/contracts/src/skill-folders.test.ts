import { describe, expect, it } from 'vitest';
import { SKILL_FOLDER_GENERIC, skillFolders } from './agent-kinds';
import { AgentKind } from './enums';

describe('skillFolders', () => {
  it.each([
    ['claude', ['.claude/skills', '.agents/skills']],
    ['codex', ['.agents/skills']],
    ['opencode', ['.opencode/skills', '.agents/skills']],
  ] as const)('%s: its own folder first, then the generic one, with no repeat', (kind, folders) => {
    expect(skillFolders(kind)).toEqual(folders);
  });

  it('every kind searches the generic folder last', () => {
    for (const kind of AgentKind.options) expect(skillFolders(kind).at(-1)).toBe(SKILL_FOLDER_GENERIC);
  });
});
