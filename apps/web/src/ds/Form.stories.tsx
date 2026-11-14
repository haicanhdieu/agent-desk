import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Button,
  Checkbox,
  Field,
  LabelInput,
  PasswordInput,
  PrefixInput,
  RadioCard,
  SearchInput,
  SegmentedControl,
  Select,
  StaticInput,
  TextInput,
  Toggle,
  UnitInput,
} from '.';

const meta = {
  title: 'Primitives/Form',
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TextInputs: Story = {
  render: () => (
    <>
      <Field label="Name" help="Shown in the desk list.">
        {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} defaultValue="Billing desk" />}
      </Field>
      <Field label="Branch">{({ id }) => <TextInput id={id} mono defaultValue="feat/forms" />}</Field>
      <Field label="Command">{({ id }) => <PrefixInput id={id} prefix="/" defaultValue="implement" />}</Field>
      <Field label="Idle timeout">{({ id }) => <UnitInput id={id} unit="minutes" defaultValue="30" />}</Field>
      <Field label="Token">
        {({ id }) => <PasswordInput id={id} revealLabel="Show token" defaultValue="hunter2" />}
      </Field>
      <Field label="Search" labelAs="span">
        {() => <SearchInput placeholder="Search runs" aria-label="Search runs" />}
      </Field>
      <Field label="Commit to" labelAs="span">
        {() => <StaticInput icon="branch">main, default branch</StaticInput>}
      </Field>
    </>
  ),
};

export const ErrorAndDisabled: Story = {
  render: () => (
    <>
      <Field label="Repository" error="Repository not found.">
        {({ id, describedBy, invalid }) => (
          <TextInput id={id} aria-describedby={describedBy} aria-invalid={invalid} defaultValue="acme/nope" />
        )}
      </Field>
      <Field label="With agent" help="One agent per project in the PoC.">
        {({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} disabled>
            <option>Claude (opus)</option>
          </Select>
        )}
      </Field>
      <Field label="Agent" help="Claude Code CLI.">
        {({ id, describedBy }) => <TextInput id={id} aria-describedby={describedBy} value="Claude" disabled readOnly />}
      </Field>
    </>
  ),
};

export const Selects: Story = {
  render: () => (
    <Field label="Model">
      {({ id }) => (
        <Select id={id}>
          <option>opus (latest Opus)</option>
          <option>sonnet</option>
        </Select>
      )}
    </Field>
  ),
};

function SegDemo() {
  const [v, setV] = useState('ticket');
  return (
    <Field label="Posted on" labelAs="span">
      {() => (
        <SegmentedControl
          aria-label="Posted on"
          value={v}
          onChange={setV}
          options={[
            { value: 'ticket', label: 'Ticket' },
            { value: 'pr', label: 'Pull request' },
            { value: 'both', label: 'Both' },
          ]}
        />
      )}
    </Field>
  );
}
export const Segmented: Story = { render: () => <SegDemo /> };

function ToggleDemo() {
  const [on, setOn] = useState(true);
  const [c, setC] = useState(false);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Toggle checked={on} onChange={setOn} aria-label="Auto-start runs" />
        <span>Auto-start runs</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Toggle checked={false} onChange={() => {}} aria-label="Disabled toggle" disabled />
        <span>Disabled</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Checkbox checked={c} onChange={setC} />
        <span>Remember this choice</span>
      </label>
    </>
  );
}
export const ToggleAndCheckbox: Story = { render: () => <ToggleDemo /> };

function CardsDemo() {
  const [repo, setRepo] = useState('web');
  const [skills, setSkills] = useState<string[]>(['review']);
  return (
    <>
      {['web', 'api'].map((r) => (
        <RadioCard
          key={r}
          type="radio"
          name="repo"
          checked={repo === r}
          onChange={() => setRepo(r)}
          title={`acme/${r}`}
          description="Default branch main"
        />
      ))}
      {['review', 'tests'].map((s) => (
        <RadioCard
          key={s}
          type="checkbox"
          name="skills"
          checked={skills.includes(s)}
          onChange={(v) => setSkills((cur) => (v ? [...cur, s] : cur.filter((x) => x !== s)))}
          title={`${s} skill`}
          description="Template"
          aside={<Button size="sm">Preview</Button>}
        />
      ))}
    </>
  );
}
export const RadioCards: Story = { render: () => <CardsDemo /> };

function LabelsDemo() {
  const [labels, setLabels] = useState(['user-story']);
  return (
    <Field label="Only if the ticket has all labels" help="Optional. Leave empty to match any ticket.">
      {({ id }) => (
        <LabelInput
          id={id}
          labels={labels}
          placeholder="Add label"
          onAdd={(l) => setLabels((c) => (c.includes(l) ? c : [...c, l]))}
          onRemove={(l) => setLabels((c) => c.filter((x) => x !== l))}
        />
      )}
    </Field>
  );
}
export const LabelInputStory: Story = { name: 'Label input', render: () => <LabelsDemo /> };
