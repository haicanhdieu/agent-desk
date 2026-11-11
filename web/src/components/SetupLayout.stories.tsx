import type { Meta, StoryObj } from '@storybook/react-vite';
import { SetupLayout } from './SetupLayout';
import { GuardsCard } from './GuardsCard';
import { CommitSummary } from './CommitSummary';

const user = { login: 'kim-hale', initials: 'KH' };
const steps = [
  { label: 'Add Claude credential', detail: 'Claude Code token, opus' },
  { label: 'Add skills', optional: true },
  { label: 'Add first rule' },
];
const meta = {
  title: 'Components/SetupLayout',
  component: SetupLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [(S) => <div style={{ display: 'flex', flexDirection: 'column', minHeight: 640 }}><S /></div>],
} satisfies Meta<typeof SetupLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Skills: Story = {
  args: {
    user, projectName: 'invoicer-api', steps, current: 1, stepLabel: 'Step 3 of 4, optional', title: 'Start from skill templates',
    intro: <>A skill is a Markdown file in your repo at <span className="mono">.claude/skills/&lt;name&gt;/SKILL.md</span>. Pick templates to add them, or skip if your repo already has skills.</>,
    children: <CommitSummary branch="main" author="agent-desk[bot]" message="Add Agent Desk skills: code-build, code-review" files={['.claude/skills/code-build/SKILL.md', '.claude/skills/code-review/SKILL.md']} />,
    footer: { back: '#', skip: '#', next: { label: 'Commit 2 skills and continue', href: '#' } },
  },
};
export const WithAside: Story = {
  args: {
    user, projectName: 'invoicer-api', steps, current: 2, stepLabel: 'Step 4 of 4', title: 'Add your first rule',
    intro: 'A rule turns a comment command into a run. We filled in the one most people start with.',
    children: <p className="muted">Rule form goes here.</p>,
    aside: <GuardsCard maxRunsPerTicket={10} changeHref="#" ignoredHref="#" />,
    footer: { back: '#', next: { label: 'Save rules and finish', href: '#' } },
  },
};
