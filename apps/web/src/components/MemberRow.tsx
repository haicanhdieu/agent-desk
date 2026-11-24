import { Button, IconButton, LabelChip, Popover } from '@/ds';
import type { MemberRowView } from '@/mocks/types';
import type { DataTableColumn } from './DataTable';
import { useRowMenu } from './useRowMenu';
import styles from './MemberRow.module.css';

export interface MemberRowProps {
  row: MemberRowView;
  /** A row action is in flight: the menu is disabled. */
  busy?: boolean;
  onChangeRole: (row: MemberRowView) => void;
  onRemove: (row: MemberRowView) => void;
}

export const memberColumns: DataTableColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'access', header: 'Access' },
  { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right' },
];

/** One row of the org's members table: name and handle, every grant as scope and role, and the row menu. Text only, never HTML. */
export function MemberRow({ row, busy, onChangeRole, onRemove }: MemberRowProps) {
  const { menuAt, open, moreRef, toggleMenu, closeMenu } = useRowMenu();
  const pick = (action: (r: MemberRowView) => void) => () => {
    closeMenu();
    action(row);
  };
  const hasMenu = row.canChangeRole || row.canRemove;
  const label = `Actions for ${row.name}`;
  const hasName = row.name !== '' && row.name !== row.handle;

  return (
    <tr>
      <td className={styles.nameCell}>
        <span className={styles.name}>
          {hasName ? (
            <>
              <span className={styles.nameText} title={row.name}>
                {row.name}
              </span>
              <span className={styles.handle}>{row.handle}</span>
            </>
          ) : (
            <span className={`${styles.handle} ${styles.handleOnly}`}>{row.handle}</span>
          )}
          {row.you && <LabelChip name="You" />}
        </span>
      </td>
      <td className={styles.accessCell}>
        <ul className={styles.grants} aria-label={`Access of ${row.name}`}>
          {row.role === null && (
            <li>
              <LabelChip name="No role" />
            </li>
          )}
          {row.grants.map((g) => (
            <li key={g.id}>
              <LabelChip name={`${g.scopeName} · ${g.roleName}`} />
            </li>
          ))}
        </ul>
      </td>
      <td className={styles.actionsCell}>
        {hasMenu && (
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
              {row.canChangeRole && (
                <Button variant="ghost" size="sm" className={styles.menuAction} onClick={pick(onChangeRole)}>
                  Change access
                </Button>
              )}
              {row.canRemove && (
                <Button variant="danger" size="sm" className={styles.menuAction} onClick={pick(onRemove)}>
                  Remove from organization
                </Button>
              )}
            </Popover>
          </span>
        )}
      </td>
    </tr>
  );
}
