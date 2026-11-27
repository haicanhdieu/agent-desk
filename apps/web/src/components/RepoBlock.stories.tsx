import type { Meta, StoryObj } from '@storybook/react-vite';
import { RepoBlock } from './RepoBlock';

const meta = {
  title: 'Components/RepoBlock',
  component: RepoBlock,
  args: { owner: 'harbor-labs', name: 'invoicer-api', branch: 'main', repoUrl: 'https://example.com/repo' },
} satisfies Meta<typeof RepoBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ok: Story = { args: { status: { tone: 'ok', text: 'Connected' } } };
export const Warning: Story = { args: { status: { tone: 'warn', text: 'Webhooks silent' } } };
export const Error: Story = { args: { status: { tone: 'err', text: 'Polling failed' } } };
export const NoBranch: Story = { args: { branch: null } };
