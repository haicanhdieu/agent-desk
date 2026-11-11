import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { Dialog } from './Dialog';

const stage = { position: 'relative', height: 420, background: 'var(--bg)', padding: 16 } as const;

function Demo({ destructive }: { destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={stage}>
      <Button data-testid="opener" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        title={destructive ? 'Delete this desk?' : 'Rename desk'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={destructive ? 'solid-danger' : 'primary'} onClick={() => setOpen(false)}>
              {destructive ? 'Delete' : 'Save'}
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          {destructive ? 'This cannot be undone.' : 'Pick a new name for this desk.'}
        </p>
      </Dialog>
    </div>
  );
}

const meta: Meta<typeof Demo> = { title: 'Primitives/Dialog', component: Demo, parameters: { layout: 'fullscreen' } };
export default meta;
type S = StoryObj<typeof Demo>;

export const Default: S = {};
export const DestructiveConfirm: S = { args: { destructive: true } };
export const OpenedByPlay: S = {
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('[data-testid="opener"]')?.click();
  },
};
