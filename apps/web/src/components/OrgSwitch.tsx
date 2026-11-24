import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AppLink, Icon, Popover } from '@/ds';
import type { OrgOption, OrgSwitchData } from '@/mocks/types';
import { menuKeyDown } from './menuKeys';
import styles from './OrgSwitch.module.css';

export interface OrgSwitchProps extends OrgSwitchData {
  orgHref: (org: OrgOption) => string;
  createHref: string;
  /** Absent means no "Projects" item. */
  projectsHref?: string;
  /** Absent means no "Settings" item. */
  settingsHref?: string;
  /** Present for a platform admin: the "Platform admin" item above "Create organization". */
  platformHref?: string;
}

const onMenuKeyDown = menuKeyDown('a[href]');

/** The org crumb of the top bar: always a menu button (org name, Projects, Settings, switch group, Create), except plain text for no org and no platform admin. */
export function OrgSwitch(props: OrgSwitchProps) {
  if (props.orgs.length === 0 && !props.current && !props.platformAdmin && props.platformHref === undefined) {
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
  platformHref,
}: OrgSwitchProps) {
  const shown = current ?? (orgs.length === 1 ? orgs[0] : undefined);
  const canSwitch = orgs.length > 1 || platformAdmin;
  const buttonLabel = shown
    ? `Switch scope, currently organization ${shown.name}`
    : 'Switch scope, currently no organization';
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
        label="Scope"
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
                      {org.suspended && <span className={styles.suspended}>Suspended</span>}
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
          {(platformAdmin || platformHref !== undefined) && (
            <>
              {(shown || orgs.length > 0) && <div className={styles.divider} role="separator" />}
              {platformHref !== undefined && (
                <AppLink href={platformHref} className={styles.item} onClick={close}>
                  <span className={styles.itemName}>Platform admin</span>
                </AppLink>
              )}
              {platformAdmin && (
                <AppLink href={createHref} className={styles.item} onClick={close}>
                  <span className={styles.itemName}>Create organization</span>
                </AppLink>
              )}
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}
