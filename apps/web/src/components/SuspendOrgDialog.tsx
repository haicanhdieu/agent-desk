import { Banner, Button, Dialog, Field, Icon, TextArea } from '@/ds';
import styles from './SuspendOrgDialog.module.css';

export interface SuspendOrgDialogProps {
  mode: 'suspend' | 'reactivate';
  orgName: string;
  open: boolean;
  reason: string;
  error?: string;
  formError?: { title: string; requestId?: string };
  saving: boolean;
  onReason: (r: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const noop = () => {};

/** Suspend or reactivate an org with a reason. Cannot be closed while the request is in flight. */
export function SuspendOrgDialog({
  mode,
  orgName,
  open,
  reason,
  error,
  formError,
  saving,
  onReason,
  onSubmit,
  onClose,
}: SuspendOrgDialogProps) {
  const suspend = mode === 'suspend';
  return (
    <Dialog
      open={open}
      title={suspend ? `Suspend ${orgName}?` : `Reactivate ${orgName}?`}
      onClose={saving ? noop : onClose}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={suspend ? 'solid-danger' : 'primary'} disabled={saving} onClick={onSubmit}>
            {suspend ? (saving ? 'Suspending…' : 'Suspend') : saving ? 'Reactivating…' : 'Reactivate'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p>
          {suspend
            ? 'People in this organization cannot open it and no new runs start. Runs already in progress finish. Nothing is deleted.'
            : 'People can open it again.'}
        </p>
        {formError && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive" title={formError.title}>
            {formError.requestId && <span className={styles.request}>Request ID: {formError.requestId}</span>}
          </Banner>
        )}
        <Field label="Reason" error={error}>
          {({ id, describedBy, invalid }) => (
            <TextArea
              id={id}
              rows={3}
              value={reason}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => onReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
