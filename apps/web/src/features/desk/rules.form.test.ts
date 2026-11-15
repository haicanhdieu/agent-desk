import { describe, expect, it } from 'vitest';
import { changedFields, type RuleValues } from './rules.form';

const skillRule: RuleValues = {
  kind: 'skill',
  command: 'code-build',
  labelFilter: [],
  target: 'issue',
  skillName: 'code-build',
  prompt: '',
  enabled: true,
};
const promptRule: RuleValues = { ...skillRule, kind: 'prompt', skillName: '', prompt: 'Triage it' };

describe('changedFields', () => {
  it('sends kind and the prompt when a skill rule switches to a prompt', () => {
    expect(changedFields(skillRule, { ...skillRule, kind: 'prompt', prompt: 'Do it' })).toEqual({
      kind: 'prompt',
      prompt: 'Do it',
    });
  });

  it('sends kind and the skill when a prompt rule switches to a skill', () => {
    expect(changedFields(promptRule, { ...promptRule, kind: 'skill', skillName: 'code-build' })).toEqual({
      kind: 'skill',
      skillName: 'code-build',
    });
  });

  it('sends only the prompt when a prompt rule edits its prompt', () => {
    expect(changedFields(promptRule, { ...promptRule, prompt: 'Triage it twice' })).toEqual({
      prompt: 'Triage it twice',
    });
  });

  it('never sends the other kind field for an edit, even when it differs', () => {
    expect(changedFields(skillRule, { ...skillRule, prompt: 'stale text' })).toEqual({});
  });

  it('sends nothing when nothing changed', () => {
    expect(changedFields(promptRule, { ...promptRule })).toEqual({});
  });
});
