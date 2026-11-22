import { useEffect, useId, useRef, useState } from 'react';
import { Banner, Button, Dialog, Icon, RadioCard } from '@/ds';
import type { RoleCardOption } from '@/mocks/types';
import styles from './ChangeRoleDialog.module.css';

export interface ChangeRoleDialogProps {
  memberName: string;
  orgName: string;
  /** The Owner card only for owner callers. */
  options: RoleCardOption[];
  /** The member's current roleId (null = No role). */
  current: string | null;
  /** Own row: the step-down warning shows when a card below Owner is picked from Owner. */
  self: boolean;
  currentIsOwner: boolean;
  saving: boolean;
  error?: { kind: 'lastOwner' } | { kind: 'forbidden'; requestId?: string };
  onSave: (roleId: string | null) => void;
  onCancel: () => void;
}

const noop = () => {};

/** Change one member's org role. Always open: mount it while the dialog is wanted. Text only, never HTML. */
export function ChangeRoleDialog({
  memberName,
  orgName,
  options,
  current,
  self,
  currentIsOwner,
  saving,
  error,
  onSave,
  onCancel,
}: ChangeRoleDialogProps) {
  const [picked, setPicked] = useState<string | null>(current);
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const noteId = useId();
  useEffect(() => {
    groupRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);

  const pickedCard = options.find((o) => o.roleId === picked);
  const ownerPicked = pickedCard?.key === 'owner';
  const stepDown = self && currentIsOwner && !ownerPicked;
  const unchanged = picked === current;

  return (
    <Dialog
      open
      title={`Change role for ${memberName}`}
      onClose={saving ? noop : onCancel}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || unchanged} onClick={() => onSave(picked)}>
            {saving ? 'Saving…' : 'Save role'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {error?.kind === 'lastOwner' && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive">
            An organization needs at least one owner.
          </Banner>
        )}
        {error?.kind === 'forbidden' && (
          <Banner tone="err" icon={<Icon name="warning" size={16} />} live="assertive" title="You don't have access">
            {error.requestId && <span className={styles.request}>Request ID: {error.requestId}</span>}
          </Banner>
        )}
        <fieldset ref={groupRef} className={styles.group} aria-describedby={ownerPicked ? noteId : undefined}>
          <legend className={styles.legend}>Role</legend>
          {options.map((o) => (
            <RadioCard
              key={o.key}
              type="radio"
              name="change-role"
              checked={o.roleId === picked}
              onChange={() => setPicked(o.roleId)}
              title={o.name}
              description={o.description}
            />
          ))}
        </fieldset>
        {ownerPicked && (
          <p id={noteId} role="status" className={styles.note}>
            Owners can change or remove every member, including other owners.
          </p>
        )}
        {stepDown && (
          <Banner tone="warn" icon={<Icon name="warning" size={16} />}>
            You will lose owner rights in {orgName}.
          </Banner>
        )}
      </div>
    </Dialog>
  );
}
