import { useEffect, useId, useRef } from 'react';
import { Banner, Button, Dialog, Field, Icon, PrefixInput, TextInput } from '@/ds';
import styles from './EditOrgDialog.module.css';

export interface EditOrgDialogProps {
  open: boolean;
  values: { name: string; slug: string };
  errors: { name?: string; slug?: string };
  /** True once the name or URL differs from what is saved. Save stays disabled until then. */
  dirty: boolean;
  saving: boolean;
  formError?: { title: string; requestId?: string };
  onChange: (v: { name: string; slug: string }) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const noop = () => {};

/** Edit an org's name and URL from the platform org detail. Cannot be closed while the request is in flight. */
export function EditOrgDialog({
  open,
  values,
  errors,
  dirty,
  saving,
  formError,
  onChange,
  onSubmit,
  onClose,
}: EditOrgDialogProps) {
  const prefixId = useId();
  const body = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (open) body.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, [open]);
  const submit = () => {
    if (dirty && !saving) onSubmit();
  };
  return (
    <Dialog
      open={open}
      title="Edit organization"
      onClose={saving ? noop : onClose}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!dirty || saving} aria-busy={saving || undefined} onClick={submit}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        ref={body}
        noValidate
        className={styles.body}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            submit();
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {formError && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive" title={formError.title}>
            {formError.requestId && <span className={styles.request}>Request ID: {formError.requestId}</span>}
          </Banner>
        )}
        <Field label="Name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              autoComplete="off"
              value={values.name}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => onChange({ ...values, name: e.target.value })}
            />
          )}
        </Field>
        <Field label="URL" help={'Links that use the old URL will show "not found".'} error={errors.slug}>
          {({ id, describedBy, invalid }) => (
            <PrefixInput
              prefix="/o/"
              prefixId={prefixId}
              id={id}
              autoComplete="off"
              value={values.slug}
              aria-describedby={[prefixId, describedBy].filter(Boolean).join(' ')}
              aria-invalid={invalid}
              onChange={(e) => onChange({ ...values, slug: e.target.value })}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
