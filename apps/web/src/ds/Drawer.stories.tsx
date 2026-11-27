import type { Meta, StoryObj } from '@storybook/react-vite';
import { Drawer } from './Drawer';

function Demo({ open }: { open: boolean }) {
  return (
    <div style={{ position: 'relative', height: 420, background: 'var(--bg)', padding: 16 }}>
      <p style={{ margin: 0, color: 'var(--muted)' }}>Page content</p>
      <Drawer open={open} label="Main menu" onClose={() => {}}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
          <a href="#overview">Overview</a>
          <a href="#runs">Runs</a>
          <a href="#settings">Settings</a>
        </nav>
      </Drawer>
    </div>
  );
}

const meta: Meta<typeof Demo> = { title: 'Primitives/Drawer', component: Demo, parameters: { layout: 'fullscreen' } };
export default meta;
type S = StoryObj<typeof Demo>;

export const Open: S = { args: { open: true } };
export const Closed: S = { args: { open: false } };
