import { useEffect, useRef } from 'react';
import { Banner, Button, Checkbox, Dialog, Field, Icon, RadioCard, Select, TextInput } from '@/ds';
import type { InviteOption } from '@/mocks/types';
import { InviteLink } from './InviteLink';
import styles from './InviteDialog.module.css';

export interface InviteDialogValues {
  email: string;
  roleId: string;
  scope: 'org' | 'projects';
  projectIds: string[];
}

export type InviteDialogStep =
  | {
      kind: 'form';
      values: InviteDialogValues;
      errors: Partial<Record<'email' | 'roleId' | 'projectIds', string>>;
      formError?: string;
      saving: boolean;
    }
  | { kind: 'created'; email: string; expiresOn: string; link: string };

export interface InviteDialogProps {
  open: boolean;
  step: InviteDialogStep;
  roles: InviteOption[];
  projects: InviteOption[];
  /** A project admin: only "Some projects", shown as text, with only the projects they administer. */
  projectsOnly: boolean;
  onChange: (v: InviteDialogValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onCopy: () => void;
  onDone: () => void;
}

const noop = () => {};

export function InviteDialog({
  open,
  step,
  roles,
  projects,
  projectsOnly,
  onChange,
  onSubmit,
  onCancel,
  onCopy,
  onDone,
}: InviteDialogProps) {
  const createdRef = useRef<HTMLDivElement>(null);
  const created = step.kind === 'created';
  useEffect(() => {
    if (open && created) {
      createdRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [open, created]);

  if (step.kind === 'created') {
    return (
      <Dialog
        open={open}
        title="Invitation created"
        onClose={onDone}
        footer={
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        }
      >
        <div className={styles.body} ref={createdRef}>
          <p className={styles.help}>
            Send this link to {step.email}. It works only for that email and expires on {step.expiresOn}.
          </p>
          <InviteLink link={step.link} onCopy={onCopy} />
        </div>
      </Dialog>
    );
  }

  const { values, errors, formError, saving } = step;
  const scope = projectsOnly ? 'projects' : values.scope;
  const toggleProject = (id: string, on: boolean) =>
    onChange({
      ...values,
      scope,
      projectIds: on ? [...values.projectIds.filter((p) => p !== id), id] : values.projectIds.filter((p) => p !== id),
    });

  return (
    <Dialog
      open={open}
      title="Invite people"
      onClose={saving ? noop : onCancel}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={onSubmit}>
            {saving ? 'Creating…' : 'Create invitation'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {formError && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />}>
            {formError}
          </Banner>
        )}
        <Field label="Email" error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="off"
              value={values.email}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => onChange({ ...values, scope, email: e.target.value })}
            />
          )}
        </Field>
        <Field label="Role" error={errors.roleId}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              value={values.roleId}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => onChange({ ...values, scope, roleId: e.target.value })}
            >
              <option value="" disabled hidden>
                Choose a role
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Access" labelAs="span" error={errors.projectIds}>
          {({ describedBy, labelId }) => (
            <div className={styles.cards} role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
              {projectsOnly ? (
                <p className={styles.text}>Some projects</p>
              ) : (
                <>
                  <RadioCard
                    type="radio"
                    name="invite-access"
                    checked={scope === 'org'}
                    onChange={() => onChange({ ...values, scope: 'org', projectIds: [] })}
                    title="Whole organization"
                  />
                  <RadioCard
                    type="radio"
                    name="invite-access"
                    checked={scope === 'projects'}
                    onChange={() => onChange({ ...values, scope: 'projects' })}
                    title="Some projects"
                  />
                </>
              )}
              {scope === 'projects' && (
                <div className={styles.projects}>
                  {projects.map((p) => (
                    <label key={p.id} className={styles.project}>
                      <Checkbox
                        checked={values.projectIds.includes(p.id)}
                        aria-label={p.label}
                        onChange={(on) => toggleProject(p.id, on)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
