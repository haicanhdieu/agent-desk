import { AppLink, Button, IconButton, Icon, InlineStatus, Popover, StatusBadge, StatusIcon } from '@/ds';
import { connectionCopy } from '@/mocks/connection';
import type { Project } from '@/mocks/types';
import composites from './Composites.module.css';
import styles from './Entry.module.css';
import { useRowMenu } from './useRowMenu';

export interface ProjectRowProps {
  project: Project;
  /** The project's runs; also the More menu's Runs. */
  href: string;
  /** The More menu's "Agent & settings" link (the agent page, which opens on its Agents tab); left out without it (the caller may not open the Desk). */
  settingsHref?: string;
  /** Where "Resume setup" goes (the project's unfinished wizard step); the button is left out without it. */
  resumeHref?: string;
  /** Where "Switch to polling" goes on a silent-webhook warning (project settings); the button is left out without it. */
  switchToPollingHref?: string;
  /** The More menu's Delete project item; the item is left out without it (the caller may not delete projects). */
  onDelete?: () => void;
}

export function ProjectRow({
  project: p,
  href,
  settingsHref,
  resumeHref,
  switchToPollingHref,
  onDelete,
}: ProjectRowProps) {
  const { tone, mode, text } = p.connection;
  const { menuAt, open, moreRef, toggleMenu, closeMenu } = useRowMenu();

  return (
    <tr>
      <td className={styles.projectCell}>
        <AppLink href={href} className={styles.name}>
          {p.name}
        </AppLink>
        <span className={styles.repo} title={p.repo}>
          {p.repo}
        </span>
      </td>
      <td className={styles.connection} data-label="GitHub">
        {tone === 'ok' && (
          <span className={styles.okRow}>
            <span title="status: succeeded" className={styles.glyph}>
              <StatusIcon status="succeeded" size={12} title="status: succeeded" />
            </span>
            {text}
          </span>
        )}
        {tone === 'warn' && (
          <>
            <InlineStatus tone="idle" icon={<Icon name="warning" size={14} />}>
              {text}
            </InlineStatus>
            {mode === 'webhook' && switchToPollingHref !== undefined && (
              <span className={styles.connAction}>
                <Button
                  size="sm"
                  href={switchToPollingHref}
                  aria-label={`${connectionCopy.switchToPolling} for ${p.name}`}
                >
                  {connectionCopy.switchToPolling}
                </Button>
              </span>
            )}
          </>
        )}
        {tone === 'err' && (
          <InlineStatus
            tone="err"
            icon={
              <span title="status: failed" className={styles.glyph}>
                <StatusIcon status="failed" size={12} title="status: failed" />
              </span>
            }
          >
            {text}
          </InlineStatus>
        )}
      </td>
      <td data-label="Needs you">
        {p.needsYou > 0 ? (
          <StatusBadge status="idle" variant="pill">
            {p.needsYou} {p.needsYou === 1 ? 'run' : 'runs'}
          </StatusBadge>
        ) : (
          <span className={styles.noneText}>None</span>
        )}
      </td>
      <td className="num" data-label="Running">
        {p.running}
      </td>
      <td className="num" data-label="Queued">
        {p.queued}
      </td>
      <td className={styles.lastRun} data-label="Last run">
        {p.lastRun}
      </td>
      <td className={styles.end}>
        {resumeHref !== undefined && (
          <Button size="sm" href={resumeHref} aria-label={`Resume setup for ${p.name}`}>
            Resume setup
          </Button>
        )}
        <span ref={moreRef}>
          <IconButton
            icon="more"
            aria-label={`More for ${p.name}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={toggleMenu}
          />
          <Popover
            open={open}
            label={`Actions for ${p.name}`}
            onClose={closeMenu}
            style={{ position: 'fixed', top: menuAt?.top, right: menuAt?.right, padding: 6, gap: 2 }}
          >
            <Button variant="ghost" size="sm" className={composites.menuAction} href={href} onClick={closeMenu}>
              Runs
            </Button>
            {settingsHref !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                className={composites.menuAction}
                href={settingsHref}
                onClick={closeMenu}
              >
                Agent &amp; settings
              </Button>
            )}
            {onDelete !== undefined && (
              <Button
                variant="danger"
                size="sm"
                icon="trash"
                className={composites.menuAction}
                onClick={() => {
                  closeMenu();
                  onDelete();
                }}
              >
                Delete project
              </Button>
            )}
          </Popover>
        </span>
      </td>
    </tr>
  );
}
