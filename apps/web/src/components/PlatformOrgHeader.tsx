import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AppLink, Button, Icon, Popover } from '@/ds';
import type { OrgStatusView } from '@/mocks/platform/orgs';
import { OrgStatus } from './OrgStatus';
import styles from './PlatformOrgHeader.module.css';

export interface PlatformOrgHeaderProps {
  name: string;
  slug: string;
  status: OrgStatusView;
  auditHref: string;
  /** The member's own page of this org. Absent for an org the person does not belong to: no "Open organization" link. */
  openHref?: string;
  onSuspend: () => void;
  onReactivate: () => void;
  /** Absent: no "Edit organization" button. */
  onEdit?: () => void;
}

const MENU_ITEMS = 'a[href],button:not([disabled])';
const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * Header of a platform org detail page: name, slug, status and the actions. Text only, never HTML.
 * "Edit organization" is the one visible button; the status change and the links sit in the More actions menu.
 */
export function PlatformOrgHeader({
  name,
  slug,
  status,
  auditHref,
  openHref,
  onSuspend,
  onReactivate,
  onEdit,
}: PlatformOrgHeaderProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // An outside press closes the menu; Escape is handled by the Popover, which also returns focus to the trigger.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  // Arrow keys, Home and End move between the menu items.
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEMS));
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.findIndex((el) => el === document.activeElement);
    let next = 0;
    if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  };

  const close = () => setOpen(false);

  return (
    <div className={styles.header}>
      <div className={styles.title}>
        <h1 className={styles.h1} tabIndex={-1}>
          {name}
        </h1>
        <div className={styles.meta}>
          <span className={styles.slug}>/o/{slug}</span>
          <OrgStatus status={status} />
        </div>
      </div>
      <div className={styles.actions}>
        {onEdit && <Button onClick={onEdit}>Edit organization</Button>}
        <div ref={wrapRef} className={styles.more}>
          <Button
            className={styles.trigger}
            aria-label="More actions"
            title="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen((o) => !o)}
            onKeyDown={onTriggerKeyDown}
          >
            <Icon name="more" size={16} />
          </Button>
          <Popover
            open={open}
            id={menuId}
            role="menu"
            label="More actions"
            width={220}
            onClose={close}
            style={{ top: 'calc(100% + 8px)', right: 0, padding: 0, gap: 0 }}
          >
            {/* The Popover is the menu (it carries the id); this wrapper handles the arrow keys. */}
            <div className={styles.menu} onKeyDown={onMenuKeyDown}>
              {status === 'active' ? (
                <button
                  type="button"
                  role="menuitem"
                  className={`${styles.item} ${styles.danger}`}
                  onClick={() => {
                    close();
                    onSuspend();
                  }}
                >
                  Suspend organization
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={() => {
                    close();
                    onReactivate();
                  }}
                >
                  Reactivate organization
                </button>
              )}
              <div role="separator" className={styles.separator} />
              <AppLink href={auditHref} role="menuitem" className={styles.item} onClick={close}>
                View audit log
              </AppLink>
              {openHref !== undefined && (
                <AppLink href={openHref} role="menuitem" className={styles.item} onClick={close}>
                  Open organization
                  <Icon name="external" size={13} />
                </AppLink>
              )}
            </div>
          </Popover>
        </div>
      </div>
    </div>
  );
}
