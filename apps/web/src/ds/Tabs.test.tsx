import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TabPanel, Tabs } from './Tabs';

type V = 'script' | 'environment';
const tabs: { value: V; label: string }[] = [
  { value: 'script', label: 'Setup script' },
  { value: 'environment', label: 'Environment' },
];

function Harness({ onChange }: { onChange?: (v: V) => void }) {
  const [value, setValue] = useState<V>('script');
  return (
    <>
      <Tabs
        tabs={tabs}
        value={value}
        label="Setup sections"
        idPrefix="t"
        onChange={(v) => {
          onChange?.(v);
          setValue(v);
        }}
      />
      <TabPanel value="script" active={value} idPrefix="t">
        Script body
      </TabPanel>
      <TabPanel value="environment" active={value} idPrefix="t">
        Environment body
      </TabPanel>
    </>
  );
}

describe('Tabs', () => {
  it('renders a labelled tablist with both tabs and aria-selected following value', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Setup sections' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('aria-selected', 'false');
  });

  it('click calls onChange with the tab value', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    expect(onChange).toHaveBeenCalledWith('environment');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowRight and ArrowLeft move focus and select', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Setup script' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Home selects and focuses the first tab, End the last', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Setup script' }).focus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowRight on the last tab wraps to the first, ArrowLeft on the first wraps to the last', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Setup script' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('aria-selected', 'true');
  });

  it('when value matches no tab, nothing is selected, the first tab is the tab stop and arrows start from it', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value={'missing' as V} label="Setup sections" idPrefix="t" onChange={onChange} />);
    const first = screen.getByRole('tab', { name: 'Setup script' });
    const second = screen.getByRole('tab', { name: 'Environment' });
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('tabindex', '-1');
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('environment');
    expect(second).toHaveFocus();
  });

  it('only the selected tab is in the tab order', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Environment' })).toHaveAttribute('tabindex', '-1');
  });

  it('aria-controls points at the active panel id, and the inactive panel is not rendered', () => {
    render(<Harness />);
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('tab', { name: 'Setup script' })).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('Script body');
    expect(panel).toHaveAttribute('aria-labelledby', screen.getByRole('tab', { name: 'Setup script' }).id);
    expect(screen.queryByText('Environment body')).toBeNull();
  });
});
