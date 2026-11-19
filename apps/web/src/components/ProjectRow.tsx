import { useEffect, useRef, useState } from 'react';
import { AppLink, Button, IconButton, Icon, InlineStatus, Popover, StatusBadge, StatusIcon } from '@/ds';
import { connectionCopy } from '@/mocks/connection';
import type { Project } from '@/mocks/types';
import styles from './Entry.module.css';

export interface ProjectRowProps {
  project: Project;
  /** The project's runs; also the More menu's Runs. */
  href: string;
  /** The More menu's Settings link (project settings). */
  settingsHref?: string;
  /** Where "Switch to polling" goes on a silent-webhook warning (project settings). */
  switchToPollingHref?: string;
}

/** Where the actions menu sits: under the More button, right edges aligned, in viewport coordinates. */
interface MenuAt {
  top: number;
  right: number;
}

export function ProjectRow({ project: p, href, settingsHref = '#', switchToPollingHref = '#' }: ProjectRowProps) {
  const { tone, mode, text } = p.connection;
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const open = menuAt !== null;

  // An outside press, a scroll or a resize closes the menu (it is placed in viewport coordinates, so it would drift).
  // Escape is handled by the Popover, which also returns focus to the More button.
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setMenuAt(null);
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !moreRef.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setMenuAt(null);
      return;
    }
    const r = moreRef.current?.getBoundingClientRect();
    setMenuAt({ top: (r?.bottom ?? 0) + 4, right: window.innerWidth - (r?.right ?? 0) });
  };
  const closeMenu = () => setMenuAt(null);

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
      <td className={styles.connection}>
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
            {mode === 'webhook' && (
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
      <td>
        {p.needsYou > 0 ? (
          <StatusBadge status="idle" variant="pill">
            {p.needsYou} {p.needsYou === 1 ? 'run' : 'runs'}
          </StatusBadge>
        ) : (
          <span className={styles.noneText}>None</span>
        )}
      </td>
      <td className="num">{p.running}</td>
      <td className="num">{p.queued}</td>
      <td className={styles.lastRun}>{p.lastRun}</td>
      <td className={styles.end}>
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
            <Button variant="ghost" size="sm" className={styles.menuAction} href={href} onClick={closeMenu}>
              Runs
            </Button>
            <Button variant="ghost" size="sm" className={styles.menuAction} href={settingsHref} onClick={closeMenu}>
              Settings
            </Button>
            {/* Delete waits for a product decision on what it does (issue 152): shown, but it cannot be chosen. */}
            <Button variant="ghost" size="sm" icon="trash" className={styles.menuAction} disabled>
              Delete
            </Button>
          </Popover>
        </span>
      </td>
    </tr>
  );
}
