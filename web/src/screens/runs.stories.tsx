import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { connectionWarnings, ignored, projects, runs, ticketGroups, user } from '@/mocks';
import { NeedsYou as NeedsYouScreen } from './NeedsYou';
import { Runs as RunsScreen } from './Runs';
import { RunsProblems as RunsProblemsScreen, type RunsProblemsWarning } from './RunsProblems';
import type { RunsFilter } from './RunsPage';
import { viewport } from './viewports';

// Artboards come from canvas.json: Runs 1440x1000, RunsProblems 1440x960, NeedsYou 1440x740.
const meta = {
  title: 'Screens/Runs',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (height: number): NonNullable<Story['decorators']> => [
  (S) => <div style={{ width: 1440, height }}><AppShell height={height} topBar={null}><S /></AppShell></div>,
];

const project = projects[0];
const common = {
  project, user, needsYou: 1, slots: { used: 2, total: 2 }, today: 'Today: 9 runs, 1 failed',
};
const counts: Record<RunsFilter, number> = { needs_you: 1, active: 2, queued: 1, ended: 6, all: 9, ignored: 3 };

export const Runs: Story = {
  name: 'Runs',
  decorators: artboard(1000),
  globals: viewport(1440, 1000),
  render: () => (
    <RunsScreen
      {...common}
      filter="all"
      counts={counts}
      groups={ticketGroups}
      needsYouRun={{
        run: runs.find((r) => r.id === 62)!,
        askedAgo: '3 minutes ago',
        slotNote: 'It holds one of your 2 slots, so Run 63 is waiting. It ends on its own after 10 minutes with nobody attached.',
        href: '/runs/62',
      }}
    />
  ),
};

const credentialWarning: RunsProblemsWarning = {
  tone: 'warn', icon: 'key', title: 'The Claude credential was rejected',
  body: 'Run 56 failed with 401 at 11:29. New runs will fail the same way until you replace the credential.',
  actions: [{ label: 'Replace credential', href: '/desk/agent' }],
};

export const RunsProblems: Story = {
  name: 'Runs, problems and ignored commands',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => (
    <RunsProblemsScreen
      {...common}
      counts={{ ...counts, ignored: ignored.length }}
      ignored={ignored}
      warnings={[connectionWarnings.webhookSilent, credentialWarning]}
    />
  ),
};

export const RunsProblemsPolling: Story = {
  name: 'Runs, problems, polling failed',
  decorators: artboard(960),
  globals: viewport(1440, 960),
  render: () => (
    <RunsProblemsScreen
      {...common}
      counts={{ ...counts, ignored: ignored.length }}
      ignored={ignored}
      warnings={[connectionWarnings.pollingFailed]}
    />
  ),
};

export const NeedsYou: Story = {
  name: 'Where needs you shows up',
  decorators: artboard(740),
  globals: viewport(1440, 740),
  render: () => <NeedsYouScreen project={project} projects={projects.slice(0, 3)} />,
};
