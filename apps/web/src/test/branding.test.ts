import { createElement } from 'react';
import { render } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Brand } from '@/components/Brand';

const webRoot = resolve(__dirname, '../..');
const publicDir = resolve(webRoot, 'public');
const doc = new DOMParser().parseFromString(readFileSync(resolve(webRoot, 'index.html'), 'utf8'), 'text/html');

const DESCRIPTION =
  'Delegate ticket-driven work to AI coding agents, run each task in an isolated Kubernetes sandbox, and monitor agent runs live.';

const meta = (attr: 'name' | 'property', key: string) =>
  doc.querySelector(`meta[${attr}="${key}"]`)?.getAttribute('content');
const icons = () => [...doc.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')];
/** A root-relative URL ("/x.svg") to the file that the web server serves from public/. */
const publicFile = (url: string) => resolve(publicDir, url.replace(/^\//, ''));

describe('index.html branding', () => {
  it('sets the document title to Agent Desk', () => {
    expect(doc.title).toBe('Agent Desk');
  });

  it('describes the product in the description, Open Graph and Twitter tags', () => {
    expect(meta('name', 'description')).toBe(DESCRIPTION);
    expect(meta('property', 'og:title')).toBe('Agent Desk');
    expect(meta('property', 'og:description')).toBe(DESCRIPTION);
    expect(meta('name', 'twitter:title')).toBe('Agent Desk');
    expect(meta('name', 'twitter:description')).toBe(DESCRIPTION);
  });

  it('sets the theme colour to the brand midnight navy', () => {
    expect(meta('name', 'theme-color')).toBe('#111827');
  });

  it('offers the icon as an SVG favicon with an ICO and an Apple touch icon fallback', () => {
    const byHref = (href: string) => icons().find((l) => l.getAttribute('href') === href);
    expect(byHref('/agent-desk-icon.svg')?.getAttribute('type')).toBe('image/svg+xml');
    expect(byHref('/favicon.ico')?.getAttribute('rel')).toBe('icon');
    expect(byHref('/apple-touch-icon.png')?.getAttribute('rel')).toBe('apple-touch-icon');
  });

  it('only points at assets that exist in public/, which the build copies to the site root', () => {
    const urls = [
      ...icons().map((l) => l.getAttribute('href')),
      meta('property', 'og:image'),
      meta('name', 'twitter:image'),
    ];
    expect(urls.length).toBeGreaterThanOrEqual(5);
    for (const url of urls) {
      expect(url, 'asset URL must be root-relative').toMatch(/^\/[^/]/);
      expect(existsSync(publicFile(url as string)), `${url} is missing from public/`).toBe(true);
    }
  });

  it('ships the logo SVGs and real raster fallbacks', () => {
    for (const name of ['horizontal', 'icon', 'monochrome', 'dark']) {
      expect(readFileSync(publicFile(`/agent-desk-${name}.svg`), 'utf8')).toMatch(/^<svg[^>]*xmlns=/);
    }
    const png = readFileSync(publicFile('/apple-touch-icon.png'));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(180);
    expect(png.readUInt32BE(20)).toBe(180);
    const ico = readFileSync(publicFile('/favicon.ico'));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
  });
});

describe('logo wordmark', () => {
  it.each(['horizontal', 'dark', 'monochrome'])('reads "Agent Desk", with a space, in agent-desk-%s.svg', (name) => {
    const svg = new DOMParser().parseFromString(
      readFileSync(publicFile(`/agent-desk-${name}.svg`), 'utf8'),
      'image/svg+xml',
    ).documentElement;
    const wordmark = [...svg.querySelectorAll('text')].map((t) => t.textContent).join('');
    expect(wordmark).toBe('Agent Desk');
  });
});

describe('Brand logo', () => {
  const tokensCss = readFileSync(resolve(webRoot, 'src/ds/tokens.css'), 'utf8');
  const brandCss = readFileSync(resolve(webRoot, 'src/components/Brand.module.css'), 'utf8');
  const brandSrc = readFileSync(resolve(webRoot, 'src/components/Brand.tsx'), 'utf8');

  /** The value of a custom property declared in tokens.css. */
  const tokenValue = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(tokensCss)?.[1].trim();
  /** The colours a Brand.module.css class paints with: its `fill`/`stroke` declarations, resolved through tokens.css. */
  const classPaint = (cls: string) => {
    // `drawing` lower-cases attribute values, class names included, hence the case-insensitive match.
    const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'i').exec(brandCss)?.[1] ?? '';
    return [...rule.matchAll(/(fill|stroke):\s*var\(--([\w-]+)\)/g)].map(
      (m) => [m[1], tokenValue(m[2])?.toLowerCase() ?? 'unresolved'] as const,
    );
  };

  /** Every drawing element as 'parent > tag [sorted attributes]'. React writes SVG props in their attribute names;
   *  a class from Brand.module.css is replaced by the fill/stroke colours it resolves to through tokens.css. */
  const drawing = (root: Element) =>
    [...root.querySelectorAll('*')]
      .filter((e) => !['title', 'desc'].includes(e.localName))
      .map((e) => {
        const attrs = new Map([...e.attributes].map((a) => [a.name, a.value.toLowerCase()]));
        for (const cls of (attrs.get('class') ?? '').split(/\s+/).filter(Boolean)) {
          for (const [prop, value] of classPaint(cls)) attrs.set(prop, value);
        }
        attrs.delete('class');
        const list = [...attrs].map(([k, v]) => `${k}=${v}`).sort();
        return `${e.parentElement?.localName} > ${e.localName} [${list.join(' ')}]`;
      });

  it('has no raw colour and no inline style in the component, so the palette stays in tokens.css', () => {
    expect(brandSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(brandSrc).not.toMatch(/\b(rgb|hsl)a?\(/);
    expect(brandSrc).not.toMatch(/style=/);
  });

  it('draws the same viewBox and elements, with the same attributes and resolved colours, as the favicon file', () => {
    const file = new DOMParser().parseFromString(
      readFileSync(publicFile('/agent-desk-icon.svg'), 'utf8'),
      'image/svg+xml',
    ).documentElement;
    const { container } = render(createElement(Brand, { withName: false }));
    const logo = container.querySelector('svg');
    expect(logo?.getAttribute('viewBox')).toBe(file.getAttribute('viewBox'));
    expect(logo && drawing(logo)).toEqual(drawing(file));
  });

  describe('horizontal lockup (the app bar brand)', () => {
    const lockupFile = new DOMParser().parseFromString(
      readFileSync(publicFile('/agent-desk-horizontal.svg'), 'utf8'),
      'image/svg+xml',
    ).documentElement;
    const lockup = () => {
      const { container } = render(createElement(Brand));
      const svg = container.querySelector('svg');
      if (!svg) throw new Error('Brand drew no svg');
      return svg;
    };
    /** The drawing without its colours: the file is drawn for a light page (dark ink), the bar is dark, so the
     *  colours come from the --logo-* tokens instead. A `none` paint is shape, not colour, so it stays. */
    const shape = (root: Element) =>
      drawing(root).map((line) => line.replace(/(?<=[[ ])(fill|stroke)=(?!none\b)[^ \]]+ ?/g, '').replace(/ \]$/, ']'));

    it('draws the same viewBox, shapes and words as agent-desk-horizontal.svg', () => {
      const logo = lockup();
      expect(logo.getAttribute('viewBox')).toBe(lockupFile.getAttribute('viewBox'));
      expect(shape(logo)).toEqual(shape(lockupFile));
      const words = (root: Element) => [...root.querySelectorAll('text')].map((t) => t.textContent);
      expect(words(logo)).toEqual(words(lockupFile));
      expect(words(logo).join('')).toBe('Agent Desk');
    });

    it('paints the lockup with the --logo-* tokens so the name is readable on the dark bar', () => {
      const paints = drawing(lockup())
        .join('\n')
        .match(/(fill|stroke)=#[0-9a-f]{6}/g);
      expect(new Set(paints)).toEqual(
        new Set(
          [
            `stroke=${tokenValue('logo-ink')}`,
            `stroke=${tokenValue('logo-violet')}`,
            `fill=${tokenValue('logo-violet')}`,
            `fill=${tokenValue('logo-teal')}`,
            `fill=${tokenValue('logo-ink')}`,
          ].map((p) => p.toLowerCase()),
        ),
      );
      // The word "Agent" is ink (white), never the file's dark #111827, which vanishes on the --panel bar.
      expect(drawing(lockup()).find((l) => l.startsWith('svg > text') && l.includes('fill=#ffffff'))).toBeDefined();
    });
  });
});
