import { expect, userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';

const meta = {
  title: 'Components/ConfirmDeleteDialog',
  component: ConfirmDeleteDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    name: 'code-e2e',
    path: '.claude/skills/code-e2e/',
    branch: 'main',
    defaultMessage: 'Remove code-e2e skill',
    onClose: () => {},
    onConfirm: () => {},
  },
  decorators: [
    (S) => (
      <div style={{ position: 'relative', height: 560 }}>
        <S />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmDeleteDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const WithRuleWarning: Story = {
  args: {
    warning: (
      <>
        Rule <code>/code-e2e</code> uses this skill. It will be disabled, and comments with that command will show as
        ignored.
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const btn = c.getByRole('button', { name: 'Delete and commit' });
    await expect(btn).toBeDisabled();
    await userEvent.type(c.getByLabelText(/Type code-e2e to confirm/), 'code-e2e');
    await expect(btn).toBeEnabled();
  },
};
