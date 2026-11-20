import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkillDiff } from './SkillDiff';

const base = 'a\nb\nc\n';
const draft = 'a\nB\nc\nd';

function rows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-kind]')).filter((el) =>
    ['same', 'add', 'del'].includes(el.dataset.kind ?? ''),
  );
}

describe('SkillDiff', () => {
  it('is a region named "Changes against main"', () => {
    render(<SkillDiff base={base} draft={draft} />);
    expect(screen.getByRole('region', { name: 'Changes against main' })).toBeInTheDocument();
  });

  it('lists every line once with removed and added rows marked', () => {
    const { container } = render(<SkillDiff base={base} draft={draft} />);
    const got = rows(container).map((r) => [r.dataset.kind, r.querySelector('[data-text]')?.textContent]);
    expect(got).toEqual([
      ['same', 'a'],
      ['del', 'b'],
      ['add', 'B'],
      ['same', 'c'],
      ['add', 'd'],
    ]);
    expect(screen.getAllByText('Removed')).toHaveLength(1);
    expect(screen.getAllByText('Added')).toHaveLength(2);
    for (const el of [...screen.getAllByText('Removed'), ...screen.getAllByText('Added')]) {
      expect(el).toHaveClass('sr-only');
    }
  });

  it("shows main's and the draft's line numbers, blank where the line does not exist", () => {
    const { container } = render(<SkillDiff base={base} draft={draft} />);
    const r = rows(container);
    const nums = (row: HTMLElement) => [
      row.querySelector('[data-base-no]')?.textContent,
      row.querySelector('[data-draft-no]')?.textContent,
    ];
    expect(nums(r[1]!)).toEqual(['2', '']);
    expect(nums(r[4]!)).toEqual(['', '4']);
  });

  it('marks removed rows with − and added rows with +', () => {
    const { container } = render(<SkillDiff base={base} draft={draft} />);
    const r = rows(container);
    const del = r[1]!.querySelector('[data-glyph]')!;
    const add = r[2]!.querySelector('[data-glyph]')!;
    expect(del.textContent).toBe('−');
    expect(add.textContent).toBe('+');
    expect(del).toHaveAttribute('aria-hidden', 'true');
    expect(add).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows "No changes. The editor matches main." when the draft equals main', () => {
    const { container } = render(<SkillDiff base={base} draft={base} />);
    expect(screen.getByText('No changes. The editor matches main.')).toBeInTheDocument();
    expect(rows(container)).toHaveLength(0);
  });

  it('shows skill text as text', () => {
    const { container } = render(<SkillDiff base="a" draft={'a\n<script>alert(1)</script>'} />);
    expect(container.querySelector('script')).toBeNull();
    const region = screen.getByRole('region', { name: 'Changes against main' });
    expect(within(region).getByText('<script>alert(1)</script>')).toBeInTheDocument();
  });
});
