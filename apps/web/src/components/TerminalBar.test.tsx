import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TerminalBar, type TerminalBarProps } from './TerminalBar';

const three: TerminalBarProps['views'] = [
  { id: 'term', label: 'Terminal', icon: 'terminal' },
  { id: 'mid', label: 'Middle', icon: 'transcript', soon: 'coming' },
  { id: 'tr', label: 'Transcript', icon: 'transcript' },
  { id: 'log', label: 'Log', icon: 'terminal' },
];

function Controlled({ views, onViewChange }: { views: TerminalBarProps['views']; onViewChange: (id: string) => void }) {
  const [active, setActive] = useState(views[0].id);
  return (
    <>
      <TerminalBar
        views={views}
        activeView={active}
        connection={null}
        onViewChange={(id) => {
          onViewChange(id);
          setActive(id);
        }}
      />
      <button type="button">outside</button>
    </>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

async function focusFirst() {
  await userEvent.tab();
  expect(tab('Terminal')).toHaveFocus();
}

describe('TerminalBar view tabs keyboard (BR-81)', () => {
  it('ArrowRight focuses and selects the next usable tab, skipping a soon one', async () => {
    const onViewChange = vi.fn();
    render(<Controlled views={three} onViewChange={onViewChange} />);
    await focusFirst();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Transcript')).toHaveFocus();
    expect(onViewChange).toHaveBeenLastCalledWith('tr');
    expect(tab('Transcript')).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowRight wraps from the last tab to the first', async () => {
    const onViewChange = vi.fn();
    render(<Controlled views={three} onViewChange={onViewChange} />);
    await focusFirst();
    await userEvent.keyboard('{End}{ArrowRight}');
    expect(tab('Terminal')).toHaveFocus();
    expect(onViewChange).toHaveBeenLastCalledWith('term');
  });

  it('ArrowLeft goes to the previous tab and wraps from the first to the last', async () => {
    const onViewChange = vi.fn();
    render(<Controlled views={three} onViewChange={onViewChange} />);
    await focusFirst();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Log')).toHaveFocus();
    expect(onViewChange).toHaveBeenLastCalledWith('log');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Transcript')).toHaveFocus();
  });

  it('Home and End go to the first and last usable tab', async () => {
    const onViewChange = vi.fn();
    render(<Controlled views={three} onViewChange={onViewChange} />);
    await focusFirst();
    await userEvent.keyboard('{End}');
    expect(tab('Log')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tab('Terminal')).toHaveFocus();
    expect(onViewChange).toHaveBeenLastCalledWith('term');
  });

  it('prevents the page default for the handled keys', async () => {
    render(<Controlled views={three} onViewChange={vi.fn()} />);
    await focusFirst();
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(fireEvent.keyDown(screen.getByRole('tablist'), { key })).toBe(false);
    }
  });

  it('puts only the selected tab in the Tab order', () => {
    render(<Controlled views={three} onViewChange={vi.fn()} />);
    expect(tab('Terminal')).toHaveAttribute('tabindex', '0');
    expect(tab('Transcript')).toHaveAttribute('tabindex', '-1');
    expect(tab('Log')).toHaveAttribute('tabindex', '-1');
  });

  it('falls back to the first usable tab when activeView is a soon view', () => {
    render(<TerminalBar views={three} activeView="mid" connection={null} />);
    expect(tab('Terminal')).toHaveAttribute('tabindex', '0');
    expect(tab('Middle')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Middle')).toHaveAttribute('tabindex', '-1');
    expect(tab('Transcript')).toHaveAttribute('tabindex', '-1');
  });

  it('keeps focus and the view when there is one tab', async () => {
    const onViewChange = vi.fn();
    render(<Controlled views={[three[0]]} onViewChange={onViewChange} />);
    await focusFirst();
    await userEvent.keyboard('{ArrowRight}{ArrowLeft}{Home}{End}');
    expect(tab('Terminal')).toHaveFocus();
    for (const [id] of onViewChange.mock.calls) expect(id).toBe('term');
    expect(tab('Terminal')).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores a keydown outside the tab list', async () => {
    const onViewChange = vi.fn();
    render(<Controlled views={three} onViewChange={onViewChange} />);
    screen.getByRole('button', { name: 'outside' }).focus();
    await userEvent.keyboard('{ArrowRight}{Home}{End}');
    expect(onViewChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus();
  });
});
