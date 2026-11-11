import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { agentSettings, rules, skills } from '@/mocks';
import { DeskAgent as DeskAgentScreen } from './DeskAgent';
import { DeskRules as DeskRulesScreen } from './DeskRules';
import { DeskSkills as DeskSkillsScreen, type DeskSkillsProps } from './DeskSkills';
import { StatusIcon } from '@/ds';
import { viewport } from './viewports';

// Artboards come from canvas.json: DeskSkills, DeskSkillDelete, DeskRules 1440x900; DeskAgent 1440x1240.
const meta = {
  title: 'Screens/Desk',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const artboard = (height: number): NonNullable<Story['decorators']> => [
  (S) => <div style={{ width: 1440, height }}><AppShell height={height} topBar={null}><S /></AppShell></div>,
];

const skillsProps: DeskSkillsProps = {
  skills,
  activeName: 'code-build',
  dirty: true,
  changedLines: [17],
  commitMessage: 'code-build: run dotnet format before opening the PR',
};

export const DeskSkills: Story = {
  name: 'Skills editor',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} />,
};

export const DeskSkillDelete: Story = {
  name: 'Skills, delete confirmation',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => <DeskSkillsScreen {...skillsProps} deleting="code-e2e" rulesUsing={['/code-e2e']} />,
};

export const DeskRules: Story = {
  name: 'Routing rules, editing',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen
      rules={rules}
      skills={skills.map((s) => s.name)}
      editingId="r2"
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
    />
  ),
};

const ok = <StatusIcon status="succeeded" size={12} />;

export const DeskAgent: Story = {
  name: 'Agent & settings, replacing credential',
  decorators: artboard(1240),
  globals: viewport(1440, 1240),
  render: () => (
    <DeskAgentScreen
      settings={agentSettings}
      replacingCredential
      github={[
        { term: 'App installation', value: <span className="row" style={{ gap: 6 }}>{ok}harbor-labs, 1 repository</span> },
        { term: 'Repository', value: <span className="mono">harbor-labs/invoicer-api</span> },
        { term: 'Last webhook', value: <span className="row" style={{ gap: 6 }}>{ok}issue_comment, 2 min ago, accepted</span> },
        { term: 'Default branch', value: <><span className="mono">main</span> <span className="faint">protected, bot can commit skills</span></> },
      ]}
    />
  ),
};
