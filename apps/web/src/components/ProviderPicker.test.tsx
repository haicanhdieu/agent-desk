import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { providerPickerOptions } from '@/mocks';
import type { ProviderPickerOption } from './ProviderPicker';
import { ProviderPicker } from './ProviderPicker';

const options: ProviderPickerOption[] = [
  ...providerPickerOptions.runnable.map((o) => ({ kind: o.kind, label: o.label, logo: o.logo, available: true })),
  ...providerPickerOptions.comingSoon.map((o) => ({ kind: o.id, label: o.label, logo: o.logo, available: false })),
];

describe('ProviderPicker', () => {
  it('BR-4: one radio card per runnable provider inside a group named Provider; the radio name is the label only', () => {
    render(<ProviderPicker options={options} value={null} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Provider' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OpenAI Codex' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OpenCode' })).toBeInTheDocument();
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });

  it('BR-4: every Coming soon provider is a named chip, not a radio and not in the tab order', () => {
    render(<ProviderPicker options={options} value={null} onChange={() => {}} />);
    const comingSoon = options.filter((o) => !o.available);
    expect(comingSoon).toHaveLength(10);
    for (const o of comingSoon) {
      const chip = screen.getByRole('img', { name: `${o.label}, coming soon` });
      expect(chip).not.toHaveAttribute('tabindex');
      expect(chip.closest('button, input, a')).toBeNull();
    }
    expect(screen.getByRole('img', { name: 'Google Antigravity, coming soon' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('picking a card calls onChange with its kind; the picked card is checked', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ProviderPicker options={options} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'OpenCode' }));
    expect(onChange).toHaveBeenCalledWith('opencode');
    rerender(<ProviderPicker options={options} value="opencode" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'OpenCode' })).toBeChecked();
  });

  it('renders no logo as an image or title and no provider name of its own', () => {
    const { container } = render(<ProviderPicker options={options} value={null} onChange={() => {}} />);
    expect(container.querySelector('img, title')).toBeNull();
  });

  it('readOnly disables the radios', () => {
    render(<ProviderPicker options={options} value="codex" onChange={() => {}} readOnly />);
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
  });

  it('shows the error and ties it to the group', () => {
    render(<ProviderPicker options={options} value={null} onChange={() => {}} error="Pick a provider." />);
    const group = screen.getByRole('group', { name: 'Provider' });
    expect(group).toHaveAccessibleDescription('Pick a provider.');
  });

  it('autoFocus moves focus to the first card', () => {
    render(<ProviderPicker options={options} value={null} onChange={() => {}} autoFocus />);
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toHaveFocus();
  });
});
