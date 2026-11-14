import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionIndicator } from './ConnectionIndicator';
import { EventLog } from './EventLog';
import { StartupChecklist } from './StartupChecklist';
import { Terminal, TerminalPane, TerminalPlaceholder, type TermTone } from './Terminal';
import { TerminalBar } from './TerminalBar';
import styles from './Terminal.module.css';

const toneClass: Record<TermTone, string> = {
  dim: 'tDim',
  bold: 'tB',
  cyan: 'tCy',
  green: 'tGr',
  red: 'tRd',
  yellow: 'tYl',
  magenta: 'tMag',
  accent: 'tAcc',
  add: 'tAdd',
  del: 'tDel',
  dot: 'tDot',
  dotw: 'tDotw',
};

describe('Terminal', () => {
  it('maps every tone to its own class', () => {
    const tones = Object.keys(toneClass) as TermTone[];
    render(<Terminal lines={[tones.map((t) => ({ text: `x-${t}`, tone: t }))]} />);
    const seen = new Set<string>();
    for (const t of tones) {
      const cls = styles[toneClass[t]];
      expect(cls).toBeTruthy();
      expect(screen.getByText(`x-${t}`)).toHaveClass(cls);
      seen.add(cls);
    }
    expect(seen.size).toBe(tones.length);
  });

  it('is a non-live log with a default label', () => {
    render(<Terminal lines={[[{ text: 'hello' }]]} />);
    const log = screen.getByRole('log', { name: 'Claude Code terminal' });
    expect(log).toHaveAttribute('aria-live', 'off');
    expect(log).toHaveClass(styles.term);
  });

  it('renders a cursor element on the last line only when asked', () => {
    const { container, rerender } = render(<Terminal lines={[[{ text: 'a' }], [{ text: 'b' }]]} />);
    expect(container.querySelector(`.${styles.cursor}`)).toBeNull();
    rerender(<Terminal lines={[[{ text: 'a' }], [{ text: 'b' }]]} cursor />);
    const cursors = container.querySelectorAll(`.${styles.cursor}`);
    expect(cursors).toHaveLength(1);
    expect(cursors[0].parentElement).toHaveTextContent('b');
  });

  it('handles empty lines, with and without a cursor', () => {
    const { container, rerender } = render(<Terminal lines={[]} />);
    expect(screen.getByRole('log')).toBeInTheDocument();
    rerender(<Terminal lines={[]} cursor />);
    expect(container.querySelectorAll(`.${styles.cursor}`)).toHaveLength(1);
  });

  it('anchors to the bottom by default and to the top on request; dimmed adds its class', () => {
    const { rerender } = render(<Terminal lines={[]} />);
    expect(screen.getByRole('log')).not.toHaveClass(styles.top);
    rerender(<Terminal lines={[]} anchor="top" dimmed />);
    expect(screen.getByRole('log')).toHaveClass(styles.top);
    expect(screen.getByRole('log')).toHaveClass(styles.dimmed);
  });
});

describe('TerminalPane', () => {
  it('renders notice, bar, children and the overlay layer', () => {
    render(
      <TerminalPane notice={<p>notice</p>} bar={<div>the bar</div>} overlay={<div role="status">lost</div>}>
        <div>body</div>
      </TerminalPane>,
    );
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeInTheDocument();
    for (const t of ['notice', 'the bar', 'body']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('lost');
  });

  it('omits notice and overlay when not given', () => {
    const { container } = render(
      <TerminalPane bar={<div>bar</div>}>
        <div>body</div>
      </TerminalPane>,
    );
    expect(container.querySelector(`.${styles.scrim}`)).toBeNull();
  });
});

describe('TerminalPlaceholder', () => {
  it('renders title and body, not a blank panel', () => {
    render(
      <TerminalPlaceholder title="Starting the agent" body="Opens by itself.">
        extra
      </TerminalPlaceholder>,
    );
    expect(screen.getByRole('heading', { name: 'Starting the agent' })).toBeInTheDocument();
    expect(screen.getByText('Opens by itself.')).toBeInTheDocument();
    expect(screen.getByText('extra')).toBeInTheDocument();
  });
  it('works with an empty body and no children', () => {
    render(<TerminalPlaceholder title="No scrollback was saved" body="" />);
    expect(screen.getByRole('heading', { name: 'No scrollback was saved' })).toBeInTheDocument();
  });
});

const views = [
  { id: 'term', label: 'Terminal', icon: 'terminal' as const },
  { id: 'tr', label: 'Transcript', icon: 'transcript' as const, soon: 'coming in MVP' },
];

describe('TerminalBar', () => {
  it('marks the active tab and disables the soon tab', async () => {
    const onViewChange = vi.fn();
    render(<TerminalBar views={views} activeView="term" connection={<span>c</span>} onViewChange={onViewChange} />);
    expect(screen.getByRole('tablist', { name: 'Run view' })).toBeInTheDocument();
    const active = screen.getByRole('tab', { name: 'Terminal' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveClass(styles.on);
    const soon = screen.getByRole('tab', { name: /Transcript/ });
    expect(soon).toBeDisabled();
    expect(soon).toHaveAttribute('aria-disabled', 'true');
    expect(soon).toHaveAttribute('aria-selected', 'false');
    expect(soon).toHaveClass(styles.soon);
    expect(screen.getByText('coming in MVP')).toHaveClass(styles.soonTag);
    await userEvent.click(soon);
    soon.focus();
    await userEvent.keyboard('{Enter}');
    expect(onViewChange).not.toHaveBeenCalled();
  });

  it('shows size and wires Find / Copy all', async () => {
    const onFind = vi.fn();
    const onCopyAll = vi.fn();
    render(
      <TerminalBar
        views={views}
        activeView="term"
        connection={<span>c</span>}
        size="132×44"
        onFind={onFind}
        onCopyAll={onCopyAll}
      />,
    );
    expect(screen.getByText('132×44')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Find in scrollback' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(onFind).toHaveBeenCalledOnce();
    expect(onCopyAll).toHaveBeenCalledOnce();
  });

  it('omits size when absent and reports a change for an enabled tab', async () => {
    const onViewChange = vi.fn();
    const two = [views[0], { id: 'other', label: 'Other', icon: 'terminal' as const }];
    const { container } = render(
      <TerminalBar views={two} activeView="term" connection={null} onViewChange={onViewChange} />,
    );
    expect(container.querySelector(`.${styles.size}`)).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Other' }));
    expect(onViewChange).toHaveBeenCalledWith('other');
  });
});

describe('ConnectionIndicator', () => {
  it('shows text with a state class', () => {
    const { rerender } = render(<ConnectionIndicator state="reconnecting" label="Reconnecting, attempt 3" />);
    expect(screen.getByText('Reconnecting, attempt 3').closest(`.${styles.conn}`)).toHaveClass(styles.reconnecting);
    for (const s of ['live', 'none', 'ended'] as const) {
      rerender(<ConnectionIndicator state={s} label={`label ${s}`} />);
      expect(screen.getByText(`label ${s}`).closest(`.${styles.conn}`)).toHaveClass(styles[s]);
    }
  });
});

describe('StartupChecklist', () => {
  it('renders one list item per step and the active step uses the starting glyph', () => {
    render(
      <StartupChecklist
        steps={[
          { label: 'Queued', detail: 'Waited 3m', at: '14:12:03', state: 'done' },
          { label: 'Starting the pod', state: 'active' },
          { label: 'Open terminal', state: 'pending' },
        ]}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Waited 3m')).toBeInTheDocument();
    expect(screen.getByText('14:12:03')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0].querySelector('svg')).toHaveAttribute('aria-label', 'succeeded');
    expect(items[1].querySelector('svg')).toHaveAttribute('aria-label', 'starting');
    expect(items[2].querySelector('svg')).toHaveAttribute('aria-label', 'queued');
    expect(screen.getByText('Open terminal')).toHaveClass(styles.pending);
  });
  it('renders nothing breakable with no steps', () => {
    render(<StartupChecklist steps={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('EventLog', () => {
  it('renders each timestamp and text', () => {
    render(
      <EventLog
        events={[
          { at: '13:02:55', text: 'Comment received' },
          { at: '13:03:06', text: <b>Running</b> },
        ]}
      />,
    );
    expect(screen.getByText('13:02:55')).toBeInTheDocument();
    expect(screen.getByText('13:03:06')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('13:02:55')).toHaveStyle({ width: '62px' });
  });
  it('honours timeWidth and handles no events', () => {
    const { rerender } = render(<EventLog events={[{ at: '1', text: 't' }]} timeWidth={70} />);
    expect(screen.getByText('1')).toHaveStyle({ width: '70px' });
    rerender(<EventLog events={[]} />);
    expect(screen.queryByText('1')).toBeNull();
  });
});

describe('Terminal scrollable', () => {
  const lines = [[{ text: 'a very long output line '.repeat(20) }]];

  it('is keyboard-focusable and marked scrollable, so a long log can be read in full', () => {
    render(<Terminal lines={lines} scrollable aria-label="Setup log" />);
    const log = screen.getByRole('log', { name: 'Setup log' });
    expect(log).toHaveAttribute('tabindex', '0');
    expect(log.className).toContain(styles.scroll);
  });

  it('the default stays a clipped, non-focusable transcript', () => {
    render(<Terminal lines={lines} aria-label="Run log" />);
    const log = screen.getByRole('log', { name: 'Run log' });
    expect(log).not.toHaveAttribute('tabindex');
    expect(log.className).not.toContain(styles.scroll);
  });
});
