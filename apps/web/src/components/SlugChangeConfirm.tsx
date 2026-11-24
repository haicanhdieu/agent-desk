import { useEffect, useRef } from 'react';
import { Button, Dialog } from '@/ds';

export interface SlugChangeConfirmProps {
  from: string;
  to: string;
  /** The sentence that ends the warning, for example "Share the new link with your members." */
  closing: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const noop = () => {};

/** Warns before an org URL changes. Opens on "Change URL", so Enter confirms; the focus trap's own first-button focus runs earlier. */
export function SlugChangeConfirm({ from, to, closing, busy, onConfirm, onCancel }: SlugChangeConfirmProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('button[data-initial-focus]')?.focus();
  }, []);
  return (
    <div ref={root}>
      <Dialog
        open
        title="Change the organization URL?"
        width={480}
        onClose={busy ? noop : onCancel}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" data-initial-focus disabled={busy} onClick={onConfirm}>
              {busy ? 'Changing…' : 'Change URL'}
            </Button>
          </>
        }
      >
        <p className="muted">
          <span className="mono">/o/{from}</span> becomes <span className="mono">/o/{to}</span>. Links that use{' '}
          <span className="mono">/o/{from}</span> will show &quot;not found&quot;. {closing}
        </p>
      </Dialog>
    </div>
  );
}
