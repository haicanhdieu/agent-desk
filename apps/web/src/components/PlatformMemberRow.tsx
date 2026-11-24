import { Button, IconButton, Popover } from '@/ds';
import type { PlatformMemberAssignmentView, PlatformMemberRowView } from '@/mocks/platform/tabs';
import type { DataTableColumn } from './DataTable';
import { menuKeyDown } from './menuKeys';
import { useRowMenu } from './useRowMenu';
import styles from './PlatformMemberRow.module.css';

export interface PlatformMemberRowProps {
  row: PlatformMemberRowView;
  /** A row action is in flight: the menu is disabled. */
  busy?: boolean;
  onAdd: (row: PlatformMemberRowView) => void;
  onRemove: (row: PlatformMemberRowView, a: PlatformMemberAssignmentView) => void;
}

export const platformMemberColumns: DataTableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'roles', header: 'Roles' },
  { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right' },
];

const onMenuKeyDown = menuKeyDown('button:not(:disabled)');

/** One row of an org's Members tab for platform admins: person, roles and the row menu. Text only, never HTML. */
export function PlatformMemberRow({ row, busy, onAdd, onRemove }: PlatformMemberRowProps) {
  const { menuAt, open, moreRef, toggleMenu, closeMenu } = useRowMenu();
  const who = row.name ?? row.handle ?? row.email;
  const label = `Actions for ${who}`;

  return (
    <tr>
      <td>
        <span className={styles.name}>
          {row.name !== null && (
            <span className={styles.nameText} title={row.name}>
              {row.name}
            </span>
          )}
          {row.handle !== null && <span className={styles.handle}>{row.handle}</span>}
        </span>
      </td>
      <td className={styles.cell}>{row.email}</td>
      <td className={styles.cell}>
        {row.assignments.length > 0 ? (
          row.assignments.map((a) => a.label).join(', ')
        ) : (
          <span className={styles.faint}>—</span>
        )}
      </td>
      <td className={styles.actionsCell}>
        <span ref={moreRef}>
          <IconButton
            icon="more"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={busy}
            onClick={toggleMenu}
          />
          <Popover
            open={open}
            label={label}
            onClose={closeMenu}
            style={{ position: 'fixed', top: menuAt?.top, right: menuAt?.right, padding: 6, gap: 2 }}
          >
            <div onKeyDown={onMenuKeyDown}>
              <Button
                variant="ghost"
                size="sm"
                className={styles.menuAction}
                onClick={() => {
                  closeMenu();
                  onAdd(row);
                }}
              >
                Add assignment
              </Button>
              {row.assignments.map((a) => (
                <Button
                  key={a.assignmentId}
                  variant="danger"
                  size="sm"
                  className={styles.menuAction}
                  onClick={() => {
                    closeMenu();
                    onRemove(row, a);
                  }}
                >
                  {`Remove ${a.label}`}
                </Button>
              ))}
            </div>
          </Popover>
        </span>
      </td>
    </tr>
  );
}
