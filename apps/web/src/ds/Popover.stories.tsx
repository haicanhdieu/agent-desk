import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { Popover } from './Popover';

const stage = { position: 'relative', height: 260, background: 'var(--bg)', padding: 16 } as const;

function CancelConfirm() {
  const [open, setOpen] = useState(true);
  return (
    <div style={stage}>
      <Button onClick={() => setOpen(true)}>Cancel run</Button>
      <Popover open={open} label="Confirm cancel run" onClose={() => setOpen(false)}
        width={280} style={{ right: 16, top: 56 }}>
        <strong>Cancel this run?</strong>
        <span style={{ color: 'var(--muted)' }}>The agent will be stopped.</span>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={() => setOpen(false)}>Keep running</Button>
          <Button variant="solid-danger" onClick={() => setOpen(false)}>Cancel run</Button>
        </div>
      </Popover>
    </div>
  );
}

function StatusCard() {
  return (
    <div style={stage}>
      <Popover open label="Reconnecting" role="status" width={300}
        style={{ left: '50%', top: 60, transform: 'translateX(-50%)' }}>
        <strong>Reconnecting...</strong>
        <span style={{ color: 'var(--muted)' }}>Trying again in 3s.</span>
      </Popover>
    </div>
  );
}

const meta: Meta = { title: 'Primitives/Popover', parameters: { layout: 'fullscreen' } };
export default meta;
export const CancelConfirmation: StoryObj = { render: () => <CancelConfirm /> };
export const StatusCardStory: StoryObj = { name: 'Status card', render: () => <StatusCard /> };
