import { describe, expect, it } from 'vitest';
import { GENERAL_ERRORS, changedFields, validateGeneral } from './general.form';

const initial = { name: 'Harbor Labs', slug: 'harbor-labs' };

describe('changedFields (BR-16: one Save covers both, only changes are sent)', () => {
  it.each([
    ['nothing changed', initial, null],
    ['only the name', { name: 'Harbor', slug: 'harbor-labs' }, { name: 'Harbor' }],
    ['only the slug', { name: 'Harbor Labs', slug: 'harbor' }, { slug: 'harbor' }],
    ['both', { name: 'Harbor', slug: 'harbor' }, { name: 'Harbor', slug: 'harbor' }],
    ['a name that only gains outer spaces', { name: '  Harbor Labs ', slug: 'harbor-labs' }, null],
    ['a name sent trimmed', { name: ' Harbor ', slug: 'harbor-labs' }, { name: 'Harbor' }],
  ])('%s', (_label, values, expected) => {
    expect(changedFields(initial, values)).toEqual(expected);
  });
});

describe('validateGeneral', () => {
  const base = { name: 'Harbor Labs', slug: 'harbor-labs' };

  it('TC-15.3/15.4 (BR-15): 1 and 100 characters are fine', () => {
    expect(validateGeneral({ ...base, name: 'a' })).toBeUndefined();
    expect(validateGeneral({ ...base, name: 'a'.repeat(100) })).toBeUndefined();
  });

  it('TC-15.1 (BR-15): an empty or blank name asks for a name', () => {
    expect(validateGeneral({ ...base, name: '' })).toEqual({ fields: { name: GENERAL_ERRORS.nameEmpty } });
    expect(validateGeneral({ ...base, name: '   ' })).toEqual({ fields: { name: GENERAL_ERRORS.nameEmpty } });
  });

  it('TC-15.2 (BR-15): 101 characters is too long', () => {
    expect(validateGeneral({ ...base, name: 'a'.repeat(101) })).toEqual({ fields: { name: GENERAL_ERRORS.nameLong } });
  });

  it.each(['Acme', '-acme', 'acme-', 'my_org', 'my org', 'a'.repeat(64), ''])(
    'TC-17.1/17.2/17.3/17.5 (BR-17): slug %j shows the one format message',
    (slug) => {
      expect(validateGeneral({ ...base, slug })).toEqual({ fields: { slug: GENERAL_ERRORS.slugFormat } });
    },
  );

  it.each(['a', 'a'.repeat(63), 'acme-eu-1'])('TC-17.4 (BR-17): slug %j is fine', (slug) => {
    expect(validateGeneral({ ...base, slug })).toBeUndefined();
  });

  it('reports the name and the slug together', () => {
    expect(validateGeneral({ name: '', slug: 'Acme' })).toEqual({
      fields: { name: GENERAL_ERRORS.nameEmpty, slug: GENERAL_ERRORS.slugFormat },
    });
  });

  it('uses the spec copy', () => {
    expect(GENERAL_ERRORS).toEqual({
      nameEmpty: 'Enter a name.',
      nameLong: 'Use 100 characters or fewer.',
      slugFormat: 'Use lowercase letters, numbers and dashes, with no dash at the start or end.',
      slugTaken: 'This URL is taken. Try another.',
    });
  });
});
