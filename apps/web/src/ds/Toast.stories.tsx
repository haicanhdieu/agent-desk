import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { ToastProvider, useToast } from './Toast';
import type { StatusTone } from './tokens';

const samples: { tone: StatusTone; title: string; detail?: string; label: string }[] = [
  { tone: 'ok', title: 'Rule enabled', label: 'Success' },
  { tone: 'idle', title: 'Cancelling run 62', detail: 'The final status arrives in a moment.', label: 'Info' },
  { tone: 'err', title: 'Could not cancel run 62', detail: 'The run already finished.', label: 'Error (stays)' },
];

function Demo() {
  const toast = useToast();
  return (
    <div className="row" style={{ gap: 12, padding: 16, minHeight: 240 }}>
      {samples.map((s) => (
        <Button key={s.label} onClick={() => toast.show({ tone: s.tone, title: s.title, detail: s.detail })}>
          {s.label}
        </Button>
      ))}
    </div>
  );
}

const meta: Meta = {
  title: 'Primitives/Toast',
  component: Demo,
  render: () => (
    <ToastProvider>
      <Demo />
    </ToastProvider>
  ),
};
export default meta;
export const Playground: StoryObj = {};
