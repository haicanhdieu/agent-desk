import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, Field, UnitInput } from '@/ds';
import { SettingsSection } from './SettingsSection';

const meta = {
  title: 'Components/SettingsSection',
  component: SettingsSection,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SettingsSection>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Limits: Story = {
  args: {
    title: 'Limits',
    description: 'Guards against runaway cost and stuck runs.',
    children: (
      <>
        <Field label="Run time limit" help="Max 55. The repo token expires after 60.">
          {({ id, describedBy }) => (
            <UnitInput unit="minutes" id={id} aria-describedby={describedBy} defaultValue="30" />
          )}
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary">Save limits</Button>
        </div>
      </>
    ),
  },
};
export const NoDescription: Story = { args: { title: 'Danger zone', children: <p className="muted">Content</p> } };
