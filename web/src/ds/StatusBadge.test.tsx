import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';
import { RUN_STATUSES, statusTokens, type RunStatus } from './tokens';

describe('StatusBadge', () => {
  it.each(RUN_STATUSES)('renders the exact label for %s', (s) => {
    render(<StatusBadge status={s} />);
    expect(screen.getByText(statusTokens[s].label)).toBeInTheDocument();
    expect(screen.getByTitle(`status: ${s}`)).toHaveClass('st', `st-${s}`);
  });

  it('pill idle has st-pill and st-idle', () => {
    render(<StatusBadge status="idle" variant="pill" />);
    expect(screen.getByTitle('status: idle')).toHaveClass('st-pill', 'st-idle');
  });

  it('shows children instead of the label', () => {
    render(<StatusBadge status="idle" variant="pill">1 run</StatusBadge>);
    expect(screen.getByText('1 run')).toBeInTheDocument();
    expect(screen.queryByText('Needs you')).toBeNull();
  });

  it('falls back to queued for an unknown status', () => {
    render(<StatusBadge status={'weird' as RunStatus} />);
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('idle pill glyph inherits the pill colour (not amber on amber)', () => {
    render(<StatusBadge status="idle" variant="pill" />);
    const svg = screen.getByTitle('status: idle').querySelector('svg') as SVGElement;
    expect(svg.style.color).toBe('');
  });

  it('idle text glyph keeps the idle colour', () => {
    render(<StatusBadge status="idle" />);
    const svg = screen.getByTitle('status: idle').querySelector('svg') as SVGElement;
    expect(svg.style.color).toBe('var(--idle)');
  });
});
