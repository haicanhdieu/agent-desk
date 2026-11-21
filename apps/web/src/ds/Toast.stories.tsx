import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';
import { Toast, ToastProvider, ToastRegion, useToast } from './Toast';
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

/** The card drawn in place (no provider): screens use it for a toast that is part of their state. */
export const Static: StoryObj = {
  render: () => (
    <div style={{ minHeight: 160 }}>
      <ToastRegion>
        <Toast tone="ok" title="Link copied" onDismiss={() => undefined} />
        <Toast tone="err" title="Could not copy. Select the link and copy it." onDismiss={() => undefined} />
      </ToastRegion>
    </div>
  ),
};
