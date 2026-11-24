import { useEffect, useId, useRef } from 'react';
import { Banner, Button, Dialog, Field, Icon, RadioCard } from '@/ds';
import type { RoleCardOption } from '@/mocks/types';
import { MemberPicker, type MemberPickerProps } from './MemberPicker';
import styles from './AddProjectMemberDialog.module.css';

export interface AddProjectMemberDialogProps {
  projectName: string;
  orgName: string;
  picker: Omit<MemberPickerProps, 'invalid' | 'describedBy' | 'orgName'>;
  roles: RoleCardOption[];
  roleId: string | null;
  onRoleChange: (roleId: string) => void;
  errors: Partial<Record<'userId' | 'roleId', string>>;
  formError?: { title: string; detail?: string; requestId?: string };
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

const noop = () => {};

/** Add one org member to a project with a role. Always open: mount it while the dialog is wanted. Text only, never HTML. */
export function AddProjectMemberDialog({
  projectName,
  orgName,
  picker,
  roles,
  roleId,
  onRoleChange,
  errors,
  formError,
  saving,
  onSubmit,
  onCancel,
}: AddProjectMemberDialogProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const roleErrorId = useId();
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
  }, []);
  const submit = () => {
    // The parent flips `saving` synchronously on submit, which blocks a second click.
    if (saving) return;
    onSubmit();
  };

  return (
    <Dialog
      open
      title={`Add member to ${projectName}`}
      onClose={saving ? noop : onCancel}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={submit}>
            {saving ? 'Adding…' : 'Add member'}
          </Button>
        </>
      }
    >
      <div className={styles.body} ref={bodyRef}>
        {formError && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive" title={formError.title}>
            {formError.detail && <span className={styles.detail}>{formError.detail}</span>}
            {formError.requestId && <span className={styles.request}>Request ID: {formError.requestId}</span>}
          </Banner>
        )}
        <Field
          label="Person"
          help={`Only members of ${orgName} are listed. To add someone new, use Invite people.`}
          error={errors.userId}
        >
          {({ id, describedBy, invalid }) => (
            <MemberPicker {...picker} id={id} orgName={orgName} invalid={invalid} describedBy={describedBy} />
          )}
        </Field>
        <fieldset
          role="radiogroup"
          className={styles.group}
          aria-invalid={errors.roleId ? true : undefined}
          aria-describedby={errors.roleId ? roleErrorId : undefined}
        >
          <legend className={styles.legend}>Role</legend>
          {roles.map((o) => (
            <RadioCard
              key={o.key}
              type="radio"
              name="add-project-member-role"
              checked={o.roleId !== null && o.roleId === roleId}
              onChange={() => o.roleId && onRoleChange(o.roleId)}
              title={o.name}
              description={o.description}
            />
          ))}
          {errors.roleId && (
            <span id={roleErrorId} className={styles.error}>
              {errors.roleId}
            </span>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
