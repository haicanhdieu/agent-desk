import { Banner, Button, Dialog, Field, Icon, RadioCard, Select } from '@/ds';
import styles from './AssignmentDialog.module.css';

export type AssignmentRoleKey = 'owner' | 'admin' | 'member' | 'viewer';

export interface AssignmentDialogProps {
  open: boolean;
  person: { name: string | null; handle: string | null };
  roles: { key: AssignmentRoleKey; label: string }[];
  projects: { id: string; name: string }[];
  values: { access: 'org' | 'project'; roleKey: AssignmentRoleKey | ''; projectId: string };
  errors: { roleKey?: string; projectId?: string };
  saving: boolean;
  formError?: { title: string; requestId?: string };
  onChange: (v: AssignmentDialogProps['values']) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const noop = () => {};

/** Add one role assignment to a member from the platform org detail. Owner is whole-organization only. Cannot be closed while saving. */
export function AssignmentDialog({
  open,
  person,
  roles,
  projects,
  values,
  errors,
  saving,
  formError,
  onChange,
  onSubmit,
  onClose,
}: AssignmentDialogProps) {
  const { access } = values;
  const roleOptions = access === 'project' ? roles.filter((r) => r.key !== 'owner') : roles;
  const setAccess = (next: 'org' | 'project') =>
    onChange({
      ...values,
      access: next,
      roleKey: next === 'project' && values.roleKey === 'owner' ? '' : values.roleKey,
    });
  const submit = () => {
    if (!saving) onSubmit();
  };
  const primary = person.name ?? person.handle;
  return (
    <Dialog
      open={open}
      title="Add assignment"
      onClose={saving ? noop : onClose}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} aria-busy={saving || undefined} onClick={submit}>
            {saving ? 'Adding…' : 'Add assignment'}
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
        <div className={styles.person}>
          {primary && <span className={styles.name}>{primary}</span>}
          {person.name && person.handle && <span className={styles.handle}>{person.handle}</span>}
        </div>
        <Field label="Access" labelAs="span">
          {({ labelId }) => (
            <div className={styles.cards} role="group" aria-labelledby={labelId}>
              <RadioCard
                type="radio"
                name="assignment-access"
                checked={access === 'org'}
                onChange={() => setAccess('org')}
                title="Whole organization"
              />
              <RadioCard
                type="radio"
                name="assignment-access"
                checked={access === 'project'}
                onChange={() => setAccess('project')}
                title="One project"
              />
            </div>
          )}
        </Field>
        <Field label="Role" error={errors.roleKey}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              value={values.roleKey}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => {
                const match = roleOptions.find((r) => r.key === e.target.value);
                onChange({ ...values, roleKey: match ? match.key : '' });
              }}
            >
              <option value="" disabled hidden>
                Choose a role
              </option>
              {roleOptions.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {access === 'project' && (
          <Field label="Project" error={errors.projectId}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                value={values.projectId}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(e) => onChange({ ...values, projectId: e.target.value })}
              >
                <option value="" disabled hidden>
                  Choose a project
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}
