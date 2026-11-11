import type { Meta, StoryObj } from '@storybook/react-vite';
import { runDetails, terminalByRun } from '@/mocks';
import { RunDetail } from './RunDetail';
import { viewport } from './viewports';

// Artboards come from canvas.json: 1440x900 for all boards except RunReconnect (1280x800).
// The wrapper fixes the size; Storybook 10 ignores the viewport parameter.
const meta = {
  title: 'Screens/Run detail',
  component: RunDetail,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RunDetail>;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (width: number, height: number): NonNullable<Story['decorators']> => [
  (S) => <div style={{ width, height }}><S /></div>,
];

export const RunStarting: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunStarting, lines: terminalByRun[63], needsYou: 1 },
};
export const RunRunning: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunRunning, lines: terminalByRun[61], needsYou: 1, cancelConfirmOpen: true },
};
export const RunIdle: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunIdle, lines: terminalByRun[62], needsYou: 1 },
};
export const RunReconnect: Story = {
  decorators: artboard(1280, 800),
  globals: viewport(1280, 800),
  args: { data: runDetails.RunReconnect, lines: terminalByRun[61], needsYou: 1, panelCollapsed: true, height: 800 },
};
export const RunSucceeded: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunSucceeded, lines: terminalByRun[60], needsYou: 1 },
};
export const RunFailed: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunFailed, lines: terminalByRun[56], needsYou: 1 },
};
export const RunTimedOut: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunTimedOut, lines: terminalByRun[54], needsYou: 1 },
};
export const RunCancelled: Story = {
  decorators: artboard(1440, 900),
  globals: viewport(1440, 900),
  args: { data: runDetails.RunCancelled, needsYou: 1 },
};
