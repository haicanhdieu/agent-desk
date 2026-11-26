import { Button, LabelChip, Popover } from '@/ds';
import { IconButton } from '@/ds';
import type { AgentRowView } from '@/mocks/types';
import { AgentStatusMark } from './AgentStatus';
import { ProviderMark } from './ProviderMark';
import { useRowMenu } from './useRowMenu';
import styles from './AgentRow.module.css';

/** The row menu's height in px (three actions): a row near the bottom of the window opens it upward. */
const MENU_HEIGHT = 120;

export interface AgentRowProps {
  agent: AgentRowView;
  onEdit: (agent: AgentRowView) => void;
  onTest: (agent: AgentRowView) => void;
  onSetDefault: (agent: AgentRowView) => void;
  onDelete: (agent: AgentRowView) => void;
  /** A write on this row is in flight: the menu is disabled. */
  busy?: boolean;
  /** No actions but a View button. */
  readOnly?: boolean;
  /** A connection test runs on this row. */
  testing?: boolean;
  /** The project's only agent: it cannot be deleted. */
  onlyAgent?: boolean;
}

/** One agent of the Agents list. Names and labels are text, never HTML. Render it inside a list. */
export function AgentRow({
  agent,
  onEdit,
  onTest,
  onSetDefault,
  onDelete,
  busy,
  readOnly,
  testing,
  onlyAgent,
}: AgentRowProps) {
  const { menuAt, open, moreRef, toggleMenu, closeMenu } = useRowMenu(MENU_HEIGHT);
  const pick = (action: (a: AgentRowView) => void) => () => {
    closeMenu();
    action(agent);
  };
  const label = `Actions for ${agent.name}`;
  const deleteReason = onlyAgent
    ? 'a project needs at least one agent'
    : agent.isDefault
      ? 'set another default first'
      : null;

  return (
    <li className={styles.row}>
      <ProviderMark kind={agent.logo} label={agent.providerLabel} size="md" />
      <div className={styles.body}>
        <div className={styles.top}>
          <span className={styles.name} title={agent.name}>
            {agent.name}
          </span>
          {agent.isDefault && <LabelChip name="Default" />}
        </div>
        <span className={styles.detail}>{agent.detail}</span>
      </div>
      <span className={`${styles.model} model`}>{agent.model}</span>
      {testing ? (
        <AgentStatusMark tone="off" text="Testing…" busy />
      ) : (
        <AgentStatusMark tone={agent.status.tone} text={agent.status.text} />
      )}
      <div className={styles.actions}>
        {readOnly ? (
          <Button size="sm" onClick={() => onEdit(agent)}>
            View
          </Button>
        ) : (
          <>
            <Button size="sm" aria-label={`Edit ${agent.name}`} onClick={() => onEdit(agent)}>
              Edit
            </Button>
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
                style={{
                  position: 'fixed',
                  top: menuAt?.top,
                  bottom: menuAt?.bottom,
                  right: menuAt?.right,
                  padding: 6,
                  gap: 2,
                }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.menuAction}
                  disabled={testing}
                  onClick={pick(onTest)}
                >
                  Test connection
                </Button>
                {!agent.isDefault && (
                  <Button variant="ghost" size="sm" className={styles.menuAction} onClick={pick(onSetDefault)}>
                    Set as default
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  className={styles.menuAction}
                  disabled={deleteReason !== null}
                  aria-label={deleteReason ? `Delete (${deleteReason})` : undefined}
                  title={deleteReason ? `Delete (${deleteReason})` : undefined}
                  onClick={pick(onDelete)}
                >
                  Delete
                </Button>
              </Popover>
            </span>
          </>
        )}
      </div>
    </li>
  );
}
