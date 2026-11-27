import { useEffect, useId, useRef } from 'react';
import { Banner, Button, Field, Icon, PrefixInput, TextInput } from '@/ds';
import { InviteLink, PageHeader, SurfaceCard, useShellOwnsChrome } from '@/components';
import styles from './Screens.module.css';

export interface CreateOrgValues {
  name: string;
  slug: string;
  email: string;
}

export type CreateOrgState =
  | {
      kind: 'form';
      values: CreateOrgValues;
      errors: Partial<Record<'name' | 'slug' | 'email', string>>;
      formError?: { title: string; requestId?: string };
      saving: boolean;
    }
  | {
      kind: 'invitationFailed';
      values: CreateOrgValues;
      errors: Partial<Record<'email', string>>;
      title: string;
      retrying: boolean;
    }
  | { kind: 'created'; orgId: string; email: string; expiresOn: string; link: string }
  | { kind: 'forbidden' };

export interface CreateOrgProps {
  state: CreateOrgState;
  onChange: (v: CreateOrgValues) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onCopy: () => void;
  onDone: () => void;
}

const HINT = 'They get the owner role. Send them the link that appears next.';

/**
 * The platform admin's create-org form: name, URL and the first owner's email, then the owner's invitation link.
 * The page renders inside the platform shell, which draws the bar.
 */
export function CreateOrg({ state, onChange, onSubmit, onRetry, onCopy, onDone }: CreateOrgProps) {
  const owned = useShellOwnsChrome();
  // In the shell the title is the page header's h1; the no-access notice keeps its own centred one.
  const inHeader = owned && state.kind !== 'forbidden';
  return (
    <main className={inHeader ? styles.shellMain : styles.emptyMain}>
      {inHeader && <PageHeader title="Create an organization" />}
      {body(state, { onChange, onSubmit, onRetry, onCopy, onDone }, inHeader)}
    </main>
  );
}

type Handlers = Pick<CreateOrgProps, 'onChange' | 'onSubmit' | 'onRetry' | 'onCopy' | 'onDone'>;

function body(state: CreateOrgState, h: Handlers, titled: boolean) {
  switch (state.kind) {
    case 'forbidden':
      return (
        <div className={styles.emptyNoticeCol}>
          <h1>You don&apos;t have access</h1>
          <p className="muted">Ask an owner of this organization to give you access.</p>
        </div>
      );
    case 'created':
      return (
        <div className={styles.createOrgCol}>
          {!titled && <h1>Create an organization</h1>}
          <Created {...state} onCopy={h.onCopy} onDone={h.onDone} />
        </div>
      );
    case 'invitationFailed':
      return (
        <div className={styles.createOrgCol}>
          {!titled && <h1>Create an organization</h1>}
          <Banner
            tone="err"
            icon={<Icon name="warning" size={18} />}
            title={state.title}
            live="assertive"
            centered
            actions={
              <Button
                icon="refresh"
                disabled={state.retrying}
                aria-busy={state.retrying || undefined}
                onClick={h.onRetry}
              >
                {state.retrying ? 'Retrying…' : 'Retry'}
              </Button>
            }
          >
            The organization was created. Retry to create the owner invitation.
          </Banner>
          <Fields
            values={state.values}
            errors={state.errors}
            lockOrg
            lockEmail={state.retrying}
            onChange={h.onChange}
          />
        </div>
      );
    case 'form':
      return (
        <form
          className={styles.createOrgCol}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!state.saving) h.onSubmit();
          }}
        >
          {!titled && <h1>Create an organization</h1>}
          {state.formError && (
            <Banner
              tone="err"
              icon={<Icon name="warning" size={18} />}
              title={state.formError.title}
              live="assertive"
              centered
            >
              {state.formError.requestId && (
                <span className={styles.requestId}>Request ID: {state.formError.requestId}</span>
              )}
            </Banner>
          )}
          <Fields
            values={state.values}
            errors={state.errors}
            lockOrg={state.saving}
            lockEmail={state.saving}
            onChange={h.onChange}
          />
          <div className={styles.createOrgActions}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={state.saving}
              aria-busy={state.saving || undefined}
            >
              {state.saving ? 'Creating…' : 'Create organization'}
            </Button>
          </div>
        </form>
      );
  }
}

function Fields({
  values,
  errors,
  lockOrg,
  lockEmail,
  onChange,
}: {
  values: CreateOrgValues;
  errors: Partial<Record<'name' | 'slug' | 'email', string>>;
  lockOrg: boolean;
  lockEmail: boolean;
  onChange: (v: CreateOrgValues) => void;
}) {
  const prefixId = useId();
  return (
    <div className={styles.createOrgFields}>
      <Field label="Name" error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            autoComplete="off"
            value={values.name}
            readOnly={lockOrg}
            aria-readonly={lockOrg || undefined}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => onChange({ ...values, name: e.target.value })}
          />
        )}
      </Field>
      <Field label="URL" error={errors.slug}>
        {({ id, describedBy, invalid }) => (
          <PrefixInput
            prefix="/o/"
            prefixId={prefixId}
            id={id}
            autoComplete="off"
            value={values.slug}
            readOnly={lockOrg}
            aria-readonly={lockOrg || undefined}
            aria-describedby={[prefixId, describedBy].filter(Boolean).join(' ')}
            aria-invalid={invalid}
            onChange={(e) => onChange({ ...values, slug: e.target.value })}
          />
        )}
      </Field>
      <Field label="First owner email" help={HINT} error={errors.email}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            type="email"
            autoComplete="off"
            value={values.email}
            readOnly={lockEmail}
            aria-readonly={lockEmail || undefined}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => onChange({ ...values, email: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

function Created({
  email,
  expiresOn,
  link,
  onCopy,
  onDone,
}: {
  email: string;
  expiresOn: string;
  link: string;
  onCopy: () => void;
  onDone: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <SurfaceCard>
      <div className={styles.createOrgCreated}>
        <h2 ref={heading} tabIndex={-1}>
          Organization created
        </h2>
        <p className="muted">{`Send this link to ${email}. It works only for that email and expires on ${expiresOn}.`}</p>
        <InviteLink link={link} onCopy={onCopy} />
        <div className={styles.createOrgDone}>
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </SurfaceCard>
  );
}
