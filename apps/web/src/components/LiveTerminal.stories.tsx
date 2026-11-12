import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef } from 'react';
import LiveTerminal, { type LiveTerminalHandle } from './LiveTerminal';
import type { TermLine, TermTone } from './Terminal';
import { shortScrollback, transcript } from './terminalFixtures';

// The board transcripts as terminal output: tones become SGR colours (the theme maps them to the token colours).
const SGR: Partial<Record<TermTone, string>> = {
  dim: '90',
  bold: '1;97',
  red: '31',
  green: '32',
  yellow: '33',
  accent: '34',
  magenta: '35',
  cyan: '36',
  add: '32',
  del: '31',
  dot: '32',
  dotw: '97',
};
const ESC = '\u001b';

function ansi(lines: TermLine[]): string {
  return lines
    .map((line) =>
      line.map(({ text, tone }) => (tone && SGR[tone] ? `${ESC}[${SGR[tone]}m${text}${ESC}[0m` : text)).join(''),
    )
    .join('\r\n');
}

/** Streams the transcript through the `write` handle and echoes typed keys, like an attached run. */
function Attached() {
  const ref = useRef<LiveTerminalHandle>(null);
  useEffect(() => {
    ref.current?.write(new TextEncoder().encode(`${ansi(transcript)}\r\n\r\n> `));
  }, []);
  return <LiveTerminal ref={ref} onData={(data) => ref.current?.write(data === '\r' ? '\r\n> ' : data)} />;
}

const meta = {
  title: 'Components/LiveTerminal',
  component: LiveTerminal,
  decorators: [
    (Story) => (
      <div style={{ height: 460, display: 'flex', flexDirection: 'column', background: 'var(--term)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LiveTerminal>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = { render: () => <Attached /> };
export const ReadOnlyScrollback: Story = { args: { readOnly: true, initial: ansi(transcript) } };
export const ReadOnlyShort: Story = { args: { readOnly: true, initial: ansi(shortScrollback) } };
