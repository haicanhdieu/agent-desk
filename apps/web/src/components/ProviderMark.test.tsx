import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { AGENT_KIND_CAPABILITIES, AGENT_KINDS_COMING_SOON } from '@agentdesk/contracts';
import { providerLogos } from '@/ds/providerLogos';
import { ProviderMark } from './ProviderMark';

const kinds = [
  ...Object.values(AGENT_KIND_CAPABILITIES).map((c) => ({ kind: c.logo, label: c.label })),
  ...AGENT_KINDS_COMING_SOON.map((c) => ({ kind: c.logo, label: c.label })),
];
const withLogo = kinds.filter((k) => k.kind in providerLogos);

describe('ProviderMark', () => {
  it.each(['sm', 'md', 'lg'] as const)('renders the logo of every kind with a mark at size %s', (size) => {
    for (const { kind, label } of withLogo) {
      const { container, unmount } = render(<ProviderMark kind={kind} label={label} size={size} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
      expect(svg).toHaveAttribute('viewBox', providerLogos[kind]?.viewBox);
      expect(svg).toHaveAttribute('fill', 'currentColor');
      expect(container.querySelectorAll('path')).toHaveLength(providerLogos[kind]?.paths.length ?? -1);
      expect(container.querySelector('title')).toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('');
      unmount();
    }
  });

  it('adds no accessible name of its own', () => {
    const { container } = render(<ProviderMark kind="claude" label="Claude Code" size="md" />);
    expect(container.querySelector('[aria-label], [aria-labelledby], [role]')).toBeNull();
  });

  it('shows the uppercase first letter of the label for an unknown kind', () => {
    const { container } = render(<ProviderMark kind="not-a-kind" label="zed agent" size="sm" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container).toHaveTextContent('Z');
  });

  it('shows the monogram for a kind that has no mark', () => {
    const { container } = render(<ProviderMark kind="aider" label="Aider" size="lg" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container).toHaveTextContent('A');
  });

  it('uses the text tint by default and the muted tint when asked', () => {
    const a = render(<ProviderMark kind="claude" label="Claude Code" size="md" />);
    const b = render(<ProviderMark kind="claude" label="Claude Code" size="md" tint="muted" />);
    const ta = (a.container.firstElementChild as HTMLElement).className;
    const tb = (b.container.firstElementChild as HTMLElement).className;
    expect(ta).toContain('text');
    expect(tb).toContain('muted');
    expect(ta).not.toBe(tb);
  });

  it('puts the size class on the tile', () => {
    const { container } = render(<ProviderMark kind="claude" label="Claude Code" size="lg" />);
    expect((container.firstElementChild as HTMLElement).className).toContain('lg');
  });

  it.each(['providerLogos.ts', 'ProviderMark.tsx'])('%s holds no raw markup or file import', (name) => {
    const dir = name.endsWith('.ts') ? resolve(__dirname, '../ds') : __dirname;
    const src = readFileSync(resolve(dir, name), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML|\?raw|\.svg['"]/);
    expect(src).not.toMatch(/(?:function|const|type|interface)\s+\w*(?:Claude|Codex|OpenCode|Gemini|Cursor)\w*/);
  });
});
