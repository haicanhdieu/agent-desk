import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShellFrame } from '@/screens/shellFrame';
import { viewport } from '@/screens/viewports';
import { SetupLayout } from './SetupLayout';
import { GuardsCard } from './GuardsCard';
import { CommitSummary } from './CommitSummary';

const user = { login: 'kim-hale', initials: 'KH' };
const org = {
  current: { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' },
  orgs: [{ id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' }],
  platformAdmin: false,
  orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
};
const steps = [
  { label: 'Add agent', detail: 'Claude Code, opus' },
  { label: 'Add skills', optional: true },
  { label: 'Add first rule' },
];
const meta = {
  title: 'Components/SetupLayout',
  component: SetupLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (S) => (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 640 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof SetupLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Skills: Story = {
  args: {
    projectName: 'invoicer-api',
    steps,
    current: 1,
    stepLabel: 'Step 3 of 4, optional',
    title: 'Start from skill templates',
    intro: (
      <>
        A skill is a Markdown file in your repo at <span className="mono">.claude/skills/&lt;name&gt;/SKILL.md</span>.
        Pick templates to add them, or skip if your repo already has skills.
      </>
    ),
    children: (
      <CommitSummary
        branch="main"
        author="agent-desk[bot]"
        message="Add Agent Desk skills: code-build, code-review"
        files={['.claude/skills/code-build/SKILL.md', '.claude/skills/code-review/SKILL.md']}
      />
    ),
    footer: { back: '#', skip: '#', next: { label: 'Commit 2 skills and continue', href: '#' } },
  },
};
export const WithAside: Story = {
  args: {
    projectName: 'invoicer-api',
    steps,
    current: 2,
    stepLabel: 'Step 4 of 4',
    title: 'Add your first rule',
    intro: 'A rule turns a comment command into a run. We filled in the one most people start with.',
    children: <p className="muted">Rule form goes here.</p>,
    aside: <GuardsCard maxRunsPerTicket={10} changeHref="#" ignoredHref="#" />,
    footer: { back: '#', next: { label: 'Save rules and finish', href: '#' } },
  },
};
export const Saving: Story = {
  args: {
    ...Skills.args,
    projectName: 'invoicer-api',
    steps,
    current: 1,
    children: Skills.args?.children,
    footer: {
      back: '#',
      onSkip: () => undefined,
      next: { label: 'Commit 2 skills and continue', onClick: () => undefined, pending: true },
    },
  },
};
/** A second button before Continue and a note under the footer (the Agent step after a failed test). */
export const ContinueAnyway: Story = {
  args: {
    projectName: 'invoicer-api',
    steps,
    current: 0,
    stepLabel: 'Step 2 of 5',
    title: 'Add your agent',
    intro: 'Pick the agent you work with. Runs use it unless a rule picks another agent.',
    children: <p className="muted">Agent fields go here.</p>,
    footer: {
      back: '#',
      also: { label: 'Continue anyway', onClick: () => undefined },
      note: 'Not ready yet? You can leave setup and come back; the project keeps your progress.',
      next: { label: 'Continue', onClick: () => undefined },
    },
  },
};

// In the shell: the stepper takes the menu slot and the layout draws only the page. Below 1024px a header row at the
// top of the page holds the step label and "Exit setup"; the stepper moves into the drawer.
const shellBar = {
  user,
  crumbs: [{ label: 'Projects', href: '#projects' }, { label: 'New project' }],
  org,
} as const;
const shellArgs = {
  projectName: 'invoicer-api',
  exitHref: '#projects',
  steps,
  current: 1,
  stepLabel: 'Step 3 of 4, optional',
  title: 'Start from skill templates',
  intro: 'Pick templates to add them, or skip if your repo already has skills.',
  children: <p className="muted">Step content goes here.</p>,
  footer: { back: '#', skip: '#', next: { label: 'Continue', href: '#' } },
};
const shellStory = (
  height: number,
  args: Partial<Parameters<typeof SetupLayout>[0]>,
  globals?: Story['globals'],
): Story => ({
  args: { ...shellArgs, ...args },
  decorators: [],
  parameters: { layout: 'fullscreen' },
  ...(globals && { globals }),
  render: (a) => (
    <ShellFrame wizard height={height} topBar={shellBar}>
      <SetupLayout {...a} />
    </ShellFrame>
  ),
});
const phone = viewport(390, 844);

export const InShell: Story = shellStory(760, {});
export const InShellHeaderRow: Story = shellStory(844, {}, phone);
export const InShellReadyHeaderRow: Story = shellStory(
  844,
  {
    current: 3,
    ready: 'Ready to trigger',
    stepLabel: undefined,
    header: <h1>Project ready</h1>,
    children: <p className="muted">Ready content goes here.</p>,
    footer: undefined,
  },
  phone,
);
