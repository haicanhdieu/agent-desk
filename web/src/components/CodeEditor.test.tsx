import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditor } from './CodeEditor';

const gutter = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-ln]')).map((e) => e.textContent);

describe('CodeEditor', () => {
  it('gutter has one number per line including trailing empty line', () => {
    const { container } = render(<CodeEditor value={'a\nb\n'} aria-label="SKILL.md source" />);
    expect(gutter(container)).toEqual(['1', '2', '3']);
  });
  it('empty value still has line 1', () => {
    const { container } = render(<CodeEditor value="" aria-label="x" />);
    expect(gutter(container)).toEqual(['1']);
  });
  it('textarea carries the aria-label and the view is aria-hidden', () => {
    const { container } = render(<CodeEditor value="# T" aria-label="SKILL.md source" />);
    const ta = screen.getByRole('textbox', { name: 'SKILL.md source' });
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta).toHaveAttribute('wrap', 'off');
    expect(ta).toHaveAttribute('spellcheck', 'false');
    expect(container.querySelector('[data-view]')).toHaveAttribute('aria-hidden', 'true');
  });
  it('renders highlight spans', () => {
    const { container } = render(<CodeEditor value={'---\nname: x\n# H\nrun `main`'} aria-label="x" />);
    const view = container.querySelector('[data-view]')!;
    expect(view.textContent).toContain('name: ');
    expect(view.querySelectorAll('[data-kind="f"]')).toHaveLength(1);
    expect(view.querySelectorAll('[data-kind="k"]')).toHaveLength(1);
    expect(view.querySelectorAll('[data-kind="h"]')).toHaveLength(1);
    expect(view.querySelector('[data-kind="c"]')).toHaveTextContent('`main`');
  });
  it('changedLines marks line 17 with + and only that line', () => {
    const value = Array.from({ length: 18 }, (_, i) => `l${i + 1}`).join('\n');
    const { container } = render(<CodeEditor value={value} changedLines={[17]} aria-label="x" />);
    const marks = container.querySelectorAll('[data-changed]');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('17+');
  });
  it('out-of-range changedLines are ignored', () => {
    const { container } = render(<CodeEditor value={'a\nb'} changedLines={[0, 3, 99, -1]} aria-label="x" />);
    expect(container.querySelectorAll('[data-changed]')).toHaveLength(0);
  });
  it('typing calls onChange with the new text', async () => {
    const onChange = vi.fn();
    render(<CodeEditor value="ab" onChange={onChange} aria-label="x" />);
    await userEvent.type(screen.getByRole('textbox'), 'c');
    expect(onChange).toHaveBeenCalledWith('abc');
  });
  it('readOnly blocks typing', async () => {
    const onChange = vi.fn();
    render(<CodeEditor value="ab" onChange={onChange} readOnly aria-label="x" />);
    const ta = screen.getByRole('textbox');
    expect(ta).toHaveAttribute('readonly');
    await userEvent.type(ta, 'c');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('very long lines render intact without wrapping attributes', () => {
    const long = 'x'.repeat(5000);
    const { container } = render(<CodeEditor value={long} aria-label="x" />);
    expect(container.querySelector('[data-view]')!.textContent).toContain(long);
    expect(gutter(container)).toEqual(['1']);
  });
});
