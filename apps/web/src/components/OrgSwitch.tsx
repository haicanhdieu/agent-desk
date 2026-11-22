import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AppLink, Icon, Popover } from '@/ds';
import type { OrgOption, OrgSwitchData } from '@/mocks/types';
import styles from './OrgSwitch.module.css';

export interface OrgSwitchProps extends OrgSwitchData {
  orgHref: (org: OrgOption) => string;
  createHref: string;
  /** Absent means no "Projects" item. */
  projectsHref?: string;
  /** Absent means no "Settings" item. */
  settingsHref?: string;
}

const MENU_ITEMS = 'a[href]';
const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/** Whether the switcher renders anything: a non-admin with no org at all gets nothing. */
export function orgSwitchVisible({ current, orgs, platformAdmin }: OrgSwitchData): boolean {
  return platformAdmin || orgs.length > 1 || Boolean(current ?? orgs[0]);
}

/** The org crumb of the top bar: always a menu button (org name, Projects, Settings, switch group, Create), except plain text for no org and no platform admin. */
export function OrgSwitch(props: OrgSwitchProps) {
  if (props.orgs.length === 0 && !props.current && !props.platformAdmin) {
    return (
      <span className={styles.plain}>
        <span className={styles.name}>No organization</span>
      </span>
    );
  }
  return <OrgSwitchMenu {...props} />;
}

function OrgSwitchMenu({
  current,
  orgs,
  platformAdmin,
  orgHref,
  createHref,
  projectsHref,
  settingsHref,
}: OrgSwitchProps) {
  const shown = current ?? (orgs.length === 1 ? orgs[0] : undefined);
  const canSwitch = orgs.length > 1 || platformAdmin;
  const buttonLabel = !shown
    ? 'Switch organization'
    : canSwitch
      ? `Switch organization, currently ${shown.name}`
      : `Organization menu, ${shown.name}`;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // An outside press closes the menu; Escape is handled by the Popover, which also returns focus to the button.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

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
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.switch}
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
      >
        <span className={styles.name} title={shown?.name}>
          {shown ? shown.name : 'No organization'}
        </span>
        <Icon name="chevron-down" />
      </button>
      <Popover
        open={open}
        label="Organizations"
        onClose={close}
        style={{ top: 'calc(100% + 6px)', left: 0, padding: 0, gap: 0 }}
      >
        {/* The Popover is the dialog; this wrapper carries the id and the arrow-key handling. */}
        <div id={menuId} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {shown && (
            <div role="heading" aria-level={2} className={styles.heading} title={shown.name}>
              {shown.name}
            </div>
          )}
          {shown && projectsHref !== undefined && (
            <AppLink href={projectsHref} className={styles.item} onClick={close}>
              <Icon name="grid" size={15} />
              <span className={styles.itemName}>Projects</span>
            </AppLink>
          )}
          {shown && settingsHref !== undefined && (
            <AppLink href={settingsHref} className={styles.item} onClick={close}>
              <Icon name="sliders" size={15} />
              <span className={styles.itemName}>Settings</span>
            </AppLink>
          )}
          {canSwitch && orgs.length > 0 && (
            <>
              {shown && (projectsHref !== undefined || settingsHref !== undefined) && (
                <div className={styles.divider} role="separator" />
              )}
              <div role="group" aria-label="Switch organization" className={styles.group}>
                <div className={styles.groupLabel} aria-hidden="true">
                  Switch organization
                </div>
                {orgs.map((org) => {
                  const isCurrent = org.id === current?.id;
                  return (
                    <AppLink
                      key={org.id}
                      href={orgHref(org)}
                      className={`${styles.item} ${isCurrent ? styles.current : ''}`}
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={close}
                    >
                      <span className={styles.itemName} title={org.name}>
                        {org.name}
                      </span>
                      {isCurrent && (
                        <span className={styles.check}>
                          <Icon name="check" size={14} />
                        </span>
                      )}
                    </AppLink>
                  );
                })}
              </div>
            </>
          )}
          {platformAdmin && (
            <>
              {(shown || orgs.length > 0) && <div className={styles.divider} role="separator" />}
              <AppLink href={createHref} className={styles.item} onClick={close}>
                <span className={styles.itemName}>Create organization</span>
              </AppLink>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
