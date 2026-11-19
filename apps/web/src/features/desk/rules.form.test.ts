import { describe, expect, it } from 'vitest';
import { changedFields, toCreateRequest, validateRule, type RuleValues } from './rules.form';

const skillRule: RuleValues = {
  kind: 'skill',
  command: 'code-build',
  labelFilter: [],
  target: 'issue',
  skillName: 'code-build',
  prompt: '',
  enabled: true,
  agentId: '00000000-0000-4000-8000-0000000000a1',
  model: null,
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

describe('rule model and agent', () => {
  it('changedFields sends only model when only the model changed', () => {
    expect(changedFields(skillRule, { ...skillRule, model: 'claude-opus-4-5-20251101' })).toEqual({
      model: 'claude-opus-4-5-20251101',
    });
  });

  it('changedFields sends the trimmed model and nothing when only spaces were added', () => {
    expect(changedFields({ ...skillRule, model: 'sonnet' }, { ...skillRule, model: ' sonnet ' })).toEqual({});
    expect(changedFields(skillRule, { ...skillRule, model: ' haiku ' })).toEqual({ model: 'haiku' });
  });

  it('Default model sends model null', () => {
    expect(changedFields({ ...skillRule, model: 'sonnet' }, { ...skillRule, model: null })).toEqual({ model: null });
  });

  it('changing agentId keeps the model', () => {
    const other = '00000000-0000-4000-8000-0000000000a2';
    expect(changedFields({ ...skillRule, model: 'sonnet' }, { ...skillRule, model: 'sonnet', agentId: other })).toEqual(
      {
        agentId: other,
      },
    );
  });

  it('create sends agentId, and model null for the default and the trimmed string otherwise', () => {
    expect(toCreateRequest(skillRule)).toMatchObject({ agentId: skillRule.agentId, model: null });
    expect(toCreateRequest({ ...skillRule, model: ' sonnet ' })).toMatchObject({ model: 'sonnet' });
  });

  it.each([
    ['', 'Enter a model name.'],
    ['   ', 'Enter a model name.'],
    ['bad model!', 'Use 1 to 200 letters, digits or . _ : / @ [ ] + -, starting with a letter or digit.'],
  ])('an invalid typed model %j is a model field error before any request', (model, message) => {
    expect(validateRule({ ...skillRule, model })?.fields.model).toBe(message);
  });

  it('a 200-character model is valid and a 201-character one is a model field error', () => {
    expect(validateRule({ ...skillRule, model: 'a'.repeat(200) })).toBeUndefined();
    expect(validateRule({ ...skillRule, model: 'a'.repeat(201) })?.fields.model).toMatch(/^Use 1 to 200 letters/);
  });

  it('a null or valid model has no model error', () => {
    expect(validateRule(skillRule)).toBeUndefined();
    expect(validateRule({ ...skillRule, model: 'sonnet' })).toBeUndefined();
  });
});
