import { describe, expect, it } from 'vitest';
import { CREATE_ORG_FIELD_POINTERS, nextSlug } from './createOrg';

const blank = { name: '', slug: '', edited: false };

describe('nextSlug', () => {
  it('fills the URL from the name until the URL is edited', () => {
    expect(nextSlug(blank, { name: 'Acme Labs' })).toEqual({ slug: 'acme-labs', edited: false });
    const typed = nextSlug({ name: 'Acme', slug: 'acme', edited: false }, { name: 'Acme Labs' });
    expect(typed).toEqual({ slug: 'acme-labs', edited: false });
  });

  it('keeps an edited URL when the name changes later', () => {
    const edited = nextSlug({ name: 'Acme', slug: 'acme', edited: false }, { slug: 'my-url' });
    expect(edited).toEqual({ slug: 'my-url', edited: true });
    expect(nextSlug({ name: 'Acme', slug: 'my-url', edited: true }, { name: 'Acme Labs' })).toEqual({
      slug: 'my-url',
      edited: true,
    });
  });

  it('resumes the fill when the URL is cleared', () => {
    expect(nextSlug({ name: 'Acme Labs', slug: 'my-url', edited: true }, { slug: '' })).toEqual({
      slug: 'acme-labs',
      edited: false,
    });
  });

  it('gives `org` for a name of only symbols, never an empty URL, and nothing for an empty name', () => {
    expect(nextSlug(blank, { name: '!!!' })).toEqual({ slug: 'org', edited: false });
    expect(nextSlug({ name: 'Acme', slug: 'acme', edited: false }, { name: '' })).toEqual({ slug: '', edited: false });
  });
});

describe('CREATE_ORG_FIELD_POINTERS', () => {
  it('maps the create bodies pointers to the form fields', () => {
    expect(CREATE_ORG_FIELD_POINTERS).toEqual({ '/name': 'name', '/slug': 'slug', '/email': 'email' });
  });
});
