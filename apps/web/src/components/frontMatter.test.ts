import { describe, expect, it } from 'vitest';
import { splitFrontMatter } from './frontMatter';

describe('splitFrontMatter', () => {
  it('splits a leading front-matter block into fields and body', () => {
    expect(splitFrontMatter('---\nname: x\ndescription: Do this\n---\n\n# T')).toEqual({
      fields: [
        { key: 'name', value: 'x' },
        { key: 'description', value: 'Do this' },
      ],
      body: '\n# T',
    });
  });

  it('text without front matter is all body', () => {
    expect(splitFrontMatter('# T')).toEqual({ fields: [], body: '# T' });
    const late = '\n---\nname: x\n---\n';
    expect(splitFrontMatter(late)).toEqual({ fields: [], body: late });
  });

  it('an unclosed block is not front matter', () => {
    const t = '---\nname: x\n# T';
    expect(splitFrontMatter(t)).toEqual({ fields: [], body: t });
  });

  it('an empty block gives no fields', () => {
    expect(splitFrontMatter('---\n---\nbody')).toEqual({ fields: [], body: 'body' });
  });

  it('a block whose first line is not key: value is not front matter', () => {
    const t = '---\njust text\n---\nbody';
    expect(splitFrontMatter(t)).toEqual({ fields: [], body: t });
  });

  it('keeps colons in values and joins continuation lines', () => {
    expect(splitFrontMatter('---\ndescription: Build: then test\nnote: >\n  Long text\n  here\n---\n').fields).toEqual([
      { key: 'description', value: 'Build: then test' },
      { key: 'note', value: '> Long text here' },
    ]);
  });

  it('splitFrontMatter accepts CRLF', () => {
    expect(splitFrontMatter('---\r\nname: x\r\n---\r\nbody')).toEqual({
      fields: [{ key: 'name', value: 'x' }],
      body: 'body',
    });
  });
});
