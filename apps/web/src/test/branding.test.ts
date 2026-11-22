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

  it('uses the horizontal logo as the Open Graph and Twitter image', () => {
    expect(meta('property', 'og:image')).toBe('/agent-desk-horizontal.svg');
    expect(meta('name', 'twitter:image')).toBe('/agent-desk-horizontal.svg');
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
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

describe('Brand logo', () => {
  it('draws the same shapes and colours as the favicon file', () => {
    const file = new DOMParser().parseFromString(
      readFileSync(publicFile('/agent-desk-icon.svg'), 'utf8'),
      'image/svg+xml',
    );
    const { container } = render(createElement(Brand, { withName: false }));
    const shapes = (root: ParentNode) =>
      [...root.querySelectorAll('path, circle, rect')].map((e) =>
        [e.getAttribute('d') ?? e.getAttribute('r'), e.getAttribute('fill'), e.getAttribute('stroke')].join('|'),
      );
    expect(shapes(container)).toEqual(shapes(file));
  });
});
