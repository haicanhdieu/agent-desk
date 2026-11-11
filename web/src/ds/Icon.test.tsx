import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { StatusIcon } from './StatusIcon';
import { iconPaths } from './icons';
import type { RunStatus } from './tokens';

describe('Icon', () => {
  it('is aria-hidden by default', () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes an accessible name when aria-label is given', () => {
    render(<Icon name="check" aria-label="Done" />);
    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
  });

  it('has all 37 glyphs', () => {
    expect(Object.keys(iconPaths)).toHaveLength(37);
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
});
