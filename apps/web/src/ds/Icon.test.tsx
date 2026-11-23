import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { StatusIcon } from './StatusIcon';
import { iconPaths } from './icons';
import { RUN_STATUSES, type RunStatus } from './tokens';

describe('Icon', () => {
  it('is aria-hidden by default', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes an accessible name when aria-label is given', () => {
    render(<Icon name="check" aria-label="Done" />);
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
  });

  it('has all 43 glyphs', () => {
    expect(Object.keys(iconPaths)).toHaveLength(43);
  });

  it.each(['grid', 'sliders'] as const)('renders paths for the %s glyph', (name) => {
    const { container } = render(<Icon name={name} />);
    expect(container.querySelectorAll('svg path, svg rect, svg circle').length).toBeGreaterThan(0);
  });
});

describe('StatusIcon', () => {
  it('has role img and a name when title is given', () => {
    render(<StatusIcon status="idle" title="Needs you" />);
    expect(screen.getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
  });

  it('is aria-hidden without title', () => {
    const { container } = render(<StatusIcon status="idle" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the queued glyph for unknown status', () => {
    const a = render(<StatusIcon status={'weird' as RunStatus} />).container.innerHTML;
    const b = render(<StatusIcon status="queued" />).container.innerHTML;
    expect(a).toBe(b);
  });

  it('spins the starting ring so a booting run reads as in progress', () => {
    const { container } = render(<StatusIcon status="starting" />);
    const ring = container.querySelector('circle');
    expect(ring).toHaveAttribute('stroke-dasharray');
    expect(ring?.getAttribute('class') ?? '').toMatch(/spin/);
  });

  it.each(RUN_STATUSES.filter((s) => s !== 'starting' && s !== 'running'))(
    'does not animate the %s glyph',
    (status) => {
      const { container } = render(<StatusIcon status={status} />);
      expect(container.querySelector('[class*="spin"]')).toBeNull();
    },
  );

  it('pulses the running dot so an active run reads as in progress', () => {
    const { container } = render(<StatusIcon status="running" />);
    const dot = container.querySelector('circle[fill="currentColor"]');
    expect(dot?.getAttribute('class') ?? '').toMatch(/pulse/);
    expect(container.querySelector('[class*="spin"]')).toBeNull();
  });

  it('defines the pulse as a looping keyframe that stops under prefers-reduced-motion', () => {
    const css = readFileSync(resolve(__dirname, 'StatusIcon.module.css'), 'utf8');
    expect(css).toMatch(/\.pulse\s*\{[^}]*animation:[^;}]*\bpulse\b[^;}]*\binfinite\b/);
    expect(css).toMatch(/@keyframes\s+pulse\s*\{/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^]*\.pulse\s*\{[^}]*animation:\s*none/);
  });

  it('defines the spin as a rotation keyframe that stops under prefers-reduced-motion', () => {
    const css = readFileSync(resolve(__dirname, 'StatusIcon.module.css'), 'utf8');
    expect(css).toMatch(/\.spin\s*\{[^}]*animation:[^;}]*\bspin\b[^;}]*\binfinite\b/);
    expect(css).toMatch(/@keyframes\s+spin\s*\{[^]*rotate\(360deg\)/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^]*\.spin\s*\{[^}]*animation:\s*none/);
  });
});
