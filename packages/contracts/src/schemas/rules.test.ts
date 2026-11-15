import { describe, expect, it } from 'vitest';
import { CreateRuleRequest, UpdateRuleRequest } from './rules';

const base = { command: 'triage', labelFilter: [], target: 'any', enabled: true };

describe('CreateRuleRequest', () => {
  it('accepts a skill rule and a prompt rule, and rejects a missing kind', () => {
    expect(CreateRuleRequest.safeParse({ ...base, kind: 'skill', skillName: 'fix' }).success).toBe(true);
    expect(CreateRuleRequest.safeParse({ ...base, kind: 'prompt', prompt: 'Triage it.' }).success).toBe(true);
    expect(CreateRuleRequest.safeParse({ ...base, skillName: 'fix' }).success).toBe(false);
  });

  it('trims the prompt and bounds it at 4000 characters', () => {
    const ok = CreateRuleRequest.safeParse({
      ...base,
      kind: 'prompt',
      prompt: ' '.repeat(3) + 'x'.repeat(4000) + '\n',
    });
    expect(ok.success && ok.data.kind === 'prompt' ? ok.data.prompt : null).toBe('x'.repeat(4000));

    const long = CreateRuleRequest.safeParse({ ...base, kind: 'prompt', prompt: 'x'.repeat(4001) });
    expect(long.success).toBe(false);
    expect(!long.success && long.error.issues[0]?.path).toEqual(['prompt']);

    expect(CreateRuleRequest.safeParse({ ...base, kind: 'prompt', prompt: '   \n ' }).success).toBe(false);
  });

  it('keeps line breaks inside the prompt', () => {
    const r = CreateRuleRequest.safeParse({ ...base, kind: 'prompt', prompt: 'a\nb\n\nc' });
    expect(r.success && r.data.kind === 'prompt' ? r.data.prompt : null).toBe('a\nb\n\nc');
  });
});

describe('UpdateRuleRequest', () => {
  it.each([
    [{ kind: 'prompt' }, false, '/prompt'],
    [{ kind: 'skill' }, false, '/skillName'],
    [{ kind: 'prompt', prompt: 'p', skillName: 's' }, false, null],
    [{ prompt: 'p', skillName: 's' }, false, null],
    [{ prompt: 'p' }, true, null],
    [{ enabled: false }, true, null],
    [{}, true, null],
  ])('kind must come with its own field and never the other: %j', (input, ok, pointer) => {
    const r = UpdateRuleRequest.safeParse(input);
    expect(r.success).toBe(ok);
    if (pointer && !r.success) {
      expect(r.error.issues.map((i) => `/${i.path.join('/')}`)).toContain(pointer);
    }
  });
});
