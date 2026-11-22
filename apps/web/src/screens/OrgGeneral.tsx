import { useEffect, useId, useRef } from 'react';
import { Banner, Button, Dialog, Field, Icon, PrefixInput, TextInput, Toast, ToastRegion } from '@/ds';
import { SettingsSection } from '@/components';
import styles from './Screens.module.css';

interface FieldProps {
  value: string;
  error?: string;
  onChange: (v: string) => void;
}

export interface OrgGeneralProps {
  state: { kind: 'forbidden' } | { kind: 'ready' };
  name: FieldProps;
  slug: FieldProps;
  /** True once the name or URL differs from what is saved. Save stays disabled until then. */
  dirty: boolean;
  saving: boolean;
  formError?: { title: string; requestId?: string };
  onSave: () => void;
  /** The URL-change warning, shown before the slug is saved. */
  slugConfirm?: { from: string; to: string; onConfirm: () => void; onCancel: () => void };
  /** The outcome of the last save, shown as a dismissible toast. */
  notice?: { tone: 'ok'; title: string; onDismiss: () => void };
}

/** The dialog opens on "Change URL", so Enter confirms; the focus trap's own first-button focus runs earlier. */
function SlugConfirm({ from, to, onConfirm, onCancel }: NonNullable<OrgGeneralProps['slugConfirm']>) {
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
        onClose={onCancel}
        footer={
          <>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" data-initial-focus onClick={onConfirm}>
              Change URL
            </Button>
          </>
        }
      >
        <p className="muted">
          <span className="mono">/o/{from}</span> becomes <span className="mono">/o/{to}</span>. Links that use{' '}
          <span className="mono">/o/{from}</span> will show &quot;not found&quot;. Share the new link with your members.
        </p>
      </Dialog>
    </div>
  );
}

/** The org's General page: name and URL in one Organization section. Every value is text, never HTML. */
export function OrgGeneral({
  state,
  name,
  slug,
  dirty,
  saving,
  formError,
  onSave,
  slugConfirm,
  notice,
}: OrgGeneralProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const prefixId = useId();
  const nameError = name.error;
  const slugError = slug.error;
  useEffect(() => {
    if (nameError || slugError) formRef.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
  }, [nameError, slugError]);

  if (state.kind === 'forbidden') {
    return (
      <main className={styles.emptyNotice}>
        <div className={styles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      </main>
    );
  }

  return (
    <>
      <main className={styles.generalMain}>
        <h1 tabIndex={-1}>General</h1>
        {formError && (
          <Banner tone="err" icon={<Icon name="warning" size={18} />} title={formError.title} live="assertive" centered>
            {formError.requestId && <span className={styles.requestId}>Request ID: {formError.requestId}</span>}
          </Banner>
        )}
        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !saving) onSave();
          }}
        >
          <SettingsSection title="Organization">
            <Field label="Name" error={name.error}>
              {({ id, describedBy, invalid }) => (
                <TextInput
                  id={id}
                  autoComplete="off"
                  value={name.value}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  onChange={(e) => name.onChange(e.target.value)}
                />
              )}
            </Field>
            <Field label="URL" help={'Links that use the old URL will show "not found".'} error={slug.error}>
              {({ id, describedBy, invalid }) => (
                <PrefixInput
                  prefix="/o/"
                  prefixId={prefixId}
                  id={id}
                  autoComplete="off"
                  value={slug.value}
                  aria-describedby={[prefixId, describedBy].filter(Boolean).join(' ')}
                  aria-invalid={invalid}
                  onChange={(e) => slug.onChange(e.target.value)}
                />
              )}
            </Field>
            <div className={styles.generalActions}>
              <Button type="submit" variant="primary" disabled={!dirty || saving} aria-busy={saving || undefined}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </SettingsSection>
        </form>
      </main>
      {slugConfirm && <SlugConfirm {...slugConfirm} />}
      {notice && (
        <ToastRegion>
          <Toast tone="ok" role="status" title={notice.title} onDismiss={notice.onDismiss} />
        </ToastRegion>
      )}
    </>
  );
}
