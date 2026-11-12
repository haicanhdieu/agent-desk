import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SecretField, type CredentialType } from './SecretField';

const meta = {
  title: 'Components/SecretField',
  component: SecretField,
  decorators: [(Story) => <div style={{ maxWidth: 620 }}><Story /></div>],
} satisfies Meta<typeof SecretField>;
export default meta;
type Story = StoryObj<typeof meta>;

const info = { setAt: '12 Oct 2026', setBy: 'kim-hale' };

export const Empty: Story = { args: { state: 'empty', credentialType: 'oauth_token' } };
export const Entering: Story = { args: { state: 'entering', credentialType: 'oauth_token', submitLabel: 'Save token' } };
export const Saved: Story = {
  args: { state: 'saved', credentialType: 'oauth_token', savedInfo: { ...info, status: { tone: 'ok', text: 'Verified at 09:12' } } },
};
export const SavedRejected: Story = {
  args: { state: 'saved', credentialType: 'oauth_token', savedInfo: { ...info, status: { tone: 'err', text: 'Rejected at 11:29' } } },
};
export const Replacing: Story = {
  args: { state: 'replacing', credentialType: 'oauth_token', savedInfo: { ...info, status: { tone: 'err', text: 'Rejected at 11:29' } } },
};

function InteractiveDemo() {
    const [state, setState] = useState<'saved' | 'replacing'>('saved');
    const [type, setType] = useState<CredentialType>('oauth_token');
    return (
      <SecretField
        state={state}
        credentialType={type}
        onCredentialTypeChange={setType}
        savedInfo={{ ...info, status: { tone: 'err', text: 'Rejected at 11:29' } }}
        onReplace={() => setState((s) => (s === 'saved' ? 'replacing' : 'saved'))}
        onCancel={() => setState('saved')}
        onSubmit={() => setState('saved')}
      />
    );
}

export const Interactive: Story = {
  args: { state: 'saved', credentialType: 'oauth_token' },
  render: () => <InteractiveDemo />,
};
