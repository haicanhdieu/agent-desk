import { useEffect, useId, useRef, useState } from 'react';
import { Banner, Button, Dialog, Icon, IconButton, RadioCard, Select } from '@/ds';
import type { AccessChange, InviteOption, ProjectGrantView, RoleCardOption } from '@/mocks/types';
import styles from './ChangeRoleDialog.module.css';

export interface ChangeRoleDialogProps {
  memberName: string;
  orgName: string;
  /** The Owner card only for owner callers. */
  options: RoleCardOption[];
  /** The member's current roleId (null = No role). */
  current: string | null;
  /**
   * The Project access section of the org Members page. Absent on the project Members page, where the dialog is the
   * plain role dialog ("Change role", "Save role").
   */
  projectAccess?: {
    /** The member's project grants the caller can see, as they were when the dialog opened. */
    grants: ProjectGrantView[];
    /** The projects a grant can be added on (the caller's visible projects). */
    projects: InviteOption[];
    /** Admin, Member and Viewer: never Owner (Owner is org-only). */
    roles: RoleCardOption[];
    /** The caller may add, change and remove project grants; otherwise the section is read-only. */
    canEdit: boolean;
  };
  /** Own row: the step-down warning shows when a card below Owner is picked from Owner. */
  self: boolean;
  currentIsOwner: boolean;
  saving: boolean;
  error?: { kind: 'lastOwner' } | { kind: 'forbidden'; requestId?: string };
  onSave: (change: AccessChange) => void;
  onCancel: () => void;
}

const noop = () => {};
const DEFAULT_PROJECT_ROLE = 'member';

interface DraftGrant {
  /** The grant this row replaces or removes; absent on an added row. */
  assignmentId?: string;
  projectId: string;
  projectName: string;
  roleId: string;
  roleName: string;
}

const draftOf = (g: ProjectGrantView): DraftGrant => g;
// A grant is its project and role, so a removed-then-re-added row with the same role is no change.
const unchangedGrants = (draft: DraftGrant[], before: ProjectGrantView[]) =>
  draft.length === before.length &&
  draft.every((d) => before.some((b) => b.projectId === d.projectId && b.roleId === d.roleId));

/**
 * Change one member's access: the org role and, on the org Members page, the project grants (one role per project
 * row; add and remove). Always open: mount it while the dialog is wanted. Text only, never HTML.
 */
export function ChangeRoleDialog({
  memberName,
  orgName,
  options,
  current,
  projectAccess,
  self,
  currentIsOwner,
  saving,
  error,
  onSave,
  onCancel,
}: ChangeRoleDialogProps) {
  const projectGrants = projectAccess?.grants ?? [];
  const projects = projectAccess?.projects ?? [];
  const projectRoles = projectAccess?.roles ?? [];
  const canEditProjects = projectAccess?.canEdit ?? false;
  const [picked, setPicked] = useState<string | null>(current);
  const [draft, setDraft] = useState<DraftGrant[]>(() => projectGrants.map(draftOf));
  const [toAdd, setToAdd] = useState('');
  const [addRole, setAddRole] = useState<string>(
    () => projectRoles.find((r) => r.key === DEFAULT_PROJECT_ROLE)?.roleId ?? projectRoles[0]?.roleId ?? '',
  );
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const noteId = useId();
  useEffect(() => {
    groupRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);

  const pickedCard = options.find((o) => o.roleId === picked);
  const ownerPicked = pickedCard?.key === 'owner';
  const stepDown = self && currentIsOwner && !ownerPicked;
  const unchanged = picked === current && unchangedGrants(draft, projectGrants);
  const addable = projects.filter((p) => !draft.some((d) => d.projectId === p.id));
  const roleNameOf = (roleId: string) => projectRoles.find((r) => r.roleId === roleId)?.name;

  const setRole = (projectId: string, roleId: string) =>
    setDraft((rows) =>
      rows.map((r) => (r.projectId === projectId ? { ...r, roleId, roleName: roleNameOf(roleId) ?? r.roleName } : r)),
    );
  const add = () => {
    const project = addable.find((p) => p.id === toAdd);
    if (!project || addRole === '') return;
    setDraft((rows) => [
      ...rows,
      { projectId: project.id, projectName: project.label, roleId: addRole, roleName: roleNameOf(addRole) ?? '' },
    ]);
    setToAdd('');
  };
  const save = () =>
    onSave({
      roleId: picked,
      projects: draft.map((d) => ({
        ...(d.assignmentId !== undefined && { assignmentId: d.assignmentId }),
        projectId: d.projectId,
        roleId: d.roleId,
      })),
    });

  return (
    <Dialog
      open
      title={`${projectAccess ? 'Change access' : 'Change role'} for ${memberName}`}
      onClose={saving ? noop : onCancel}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || unchanged} onClick={save}>
            {saving ? 'Saving…' : projectAccess ? 'Save access' : 'Save role'}
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
        {projectAccess && (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Project access</legend>
            {draft.length === 0 ? (
              <p className={styles.note}>No project access.</p>
            ) : (
              <ul className={styles.grants}>
                {draft.map((d) => (
                  <li key={d.projectId} className={styles.grant} aria-label={d.projectName}>
                    <span className={styles.project} title={d.projectName}>
                      {d.projectName}
                    </span>
                    {canEditProjects ? (
                      <>
                        <Select
                          aria-label={`Role in ${d.projectName}`}
                          className={styles.roleSelect}
                          value={d.roleId}
                          disabled={saving}
                          onChange={(e) => setRole(d.projectId, e.target.value)}
                        >
                          {projectRoles.some((r) => r.roleId === d.roleId) ? null : (
                            <option value={d.roleId}>{d.roleName}</option>
                          )}
                          {projectRoles.map((r) => (
                            <option key={r.key} value={r.roleId ?? ''}>
                              {r.name}
                            </option>
                          ))}
                        </Select>
                        <IconButton
                          icon="x"
                          aria-label={`Remove access to ${d.projectName}`}
                          disabled={saving}
                          onClick={() => setDraft((rows) => rows.filter((r) => r.projectId !== d.projectId))}
                        />
                      </>
                    ) : (
                      <span className={styles.roleName}>{d.roleName}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEditProjects && (
              <div className={styles.addRow}>
                <Select
                  aria-label="Project to add"
                  className={styles.projectSelect}
                  value={toAdd}
                  disabled={saving}
                  onChange={(e) => setToAdd(e.target.value)}
                >
                  <option value="">Add a project…</option>
                  {addable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Role in the project to add"
                  className={styles.roleSelect}
                  value={addRole}
                  disabled={saving}
                  onChange={(e) => setAddRole(e.target.value)}
                >
                  {projectRoles.map((r) => (
                    <option key={r.key} value={r.roleId ?? ''}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <Button size="sm" icon="plus" disabled={saving || toAdd === ''} onClick={add}>
                  Add project
                </Button>
              </div>
            )}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
