import { Banner, Button, Dialog, Field, Icon, TextInput } from '@/ds';
import styles from './AddPlatformAdminDialog.module.css';

export interface AddPlatformAdminDialogProps {
  open: boolean;
  values: { email: string };
  errors: { email?: string };
  saving: boolean;
  formError?: { title: string; requestId?: string };
  onChange: (v: { email: string }) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const noop = () => {};

/** Add a platform admin by email. Cannot be closed while the request is in flight. */
export function AddPlatformAdminDialog({
  open,
  values,
  errors,
  saving,
  formError,
  onChange,
  onSubmit,
  onClose,
}: AddPlatformAdminDialogProps) {
  return (
    <Dialog
      open={open}
      title="Add platform admin"
      onClose={saving ? noop : onClose}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={onSubmit}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {formError && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive" title={formError.title}>
            {formError.requestId && <span className={styles.request}>Request ID: {formError.requestId}</span>}
          </Banner>
        )}
        <Field label="Email" help="They need an Agent Desk account with a verified email." error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="off"
              value={values.email}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => onChange({ email: e.target.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
