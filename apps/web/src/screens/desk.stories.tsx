import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { agentSettings, connectionCopy, connections, deskFrame, rules, skills } from '@/mocks';
import { DeskAgent as DeskAgentScreen } from './DeskAgent';
import { DeskRules as DeskRulesScreen, RulePane } from './DeskRules';
import { DeskSkills as DeskSkillsScreen, type DeskSkillsProps } from './DeskSkills';
import { StatusIcon } from '@/ds';
import { viewport } from './viewports';

// Artboards come from canvas.json: DeskSkills, DeskSkillDelete, DeskRules 1440x900; DeskAgent 1440x1320.
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
  frame: deskFrame,
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
    <DeskRulesScreen frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      editingId="r2"
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
    />
  ),
};

/** New rule pane after a save the server refused: a duplicate command (409 with pointer /command). */
export const DeskRulesNewRuleError: Story = {
  name: 'Routing rules, new rule refused',
  decorators: artboard(900),
  globals: viewport(1440, 900),
  render: () => (
    <DeskRulesScreen frame={deskFrame}
      rules={rules}
      skills={skills.map((s) => s.name)}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      form={(
        <RulePane
          title="New rule"
          value={{ command: 'code-build', target: 'pr', labels: [], skill: 'code-build', agent: 'Claude', enabled: true }}
          skills={skills.map((s) => s.name)}
          errors={{ command: 'A rule for /code-build already exists in this project.' }}
          onChange={() => undefined}
          onClose={() => undefined}
          onSave={() => undefined}
        />
      )}
    />
  ),
};

const ok = <StatusIcon status="succeeded" size={12} />;

const github = (last: { term: string; text: string }) => [
  { term: 'App installation', value: <span className="row" style={{ gap: 6 }}>{ok}harbor-labs, 1 repository</span> },
  { term: 'Repository', value: <span className="mono">harbor-labs/invoicer-api</span> },
  { term: last.term, value: <span className="row" style={{ gap: 6 }}>{ok}{last.text}</span> },
  { term: 'Default branch', value: <><span className="mono">main</span> <span className="faint">protected, bot can commit skills</span></> },
];

export const DeskAgent: Story = {
  name: 'Agent & settings, replacing credential',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen frame={deskFrame}
      settings={agentSettings}
      replacingCredential
      github={github({ term: connectionCopy.lastEventTerm, text: 'issue_comment, 2 min ago, accepted (webhook)' })}
    />
  ),
};

export const DeskAgentSaveErrors: Story = {
  name: 'Agent & settings, refused saves',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen frame={deskFrame}
      settings={{ ...agentSettings, timeoutMinutes: 60 }}
      triggerError="Internal server error"
      limitsErrors={{ timeoutMinutes: 'Too big: expected number to be <=3300' }}
      github={github({ term: connectionCopy.lastEventTerm, text: 'issue_comment, 2 min ago, accepted (webhook)' })}
    />
  ),
};

export const DeskAgentPolling: Story = {
  name: 'Agent & settings, polling',
  decorators: artboard(1320),
  globals: viewport(1440, 1320),
  render: () => (
    <DeskAgentScreen frame={deskFrame}
      settings={agentSettings}
      connection={connections.pollingOk}
      github={github({ term: connectionCopy.lastCheckedTerm, text: '20s ago, no new comments (polling)' })}
    />
  ),
};
