import { Fragment, useId, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from 'react';
import { AppLink, Button, Icon, Popover, Skeleton } from '@/ds';
import type { OrgOption, OrgSwitchData } from '@/mocks/types';
import { useMenuNav } from './useMenuNav';
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
  /** Present for a platform admin on an org page: "Manage this org in Platform" in the Platform group (org scope only). */
  manageHref?: string;
  /** Where the bar sits: the button names Platform in the platform scope. Default 'org'. */
  scope?: 'org' | 'platform';
}

/** The scope crumb of the top bar: a menu button listing scope choices only, or plain text for one org or none and no platform role (once the list has loaded). */
export function OrgSwitch(props: OrgSwitchProps) {
  const { orgs, current, list, platformAdmin, platformHref, projectsHref, settingsHref, manageHref } = props;
  const legacy = projectsHref !== undefined || settingsHref !== undefined || manageHref !== undefined;
  // Legacy hrefs (the logo's, the org's pages) only keep the button while they lead somewhere: a suspended org's pages are refused.
  const plainWanted =
    list === undefined &&
    orgs.length <= 1 &&
    !platformAdmin &&
    platformHref === undefined &&
    (!legacy || current?.suspended === true);
  const [open, setOpen] = useState(false);
  // The switcher stays a button while it is open or holds focus, so it never vanishes under the person.
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocused(false);
  };
  if (plainWanted && !open && !focused) {
    return (
      <span className={styles.plain}>
        <span className={styles.name}>{(current ?? orgs[0])?.name ?? 'No organization'}</span>
      </span>
    );
  }
  return (
    <div ref={wrapRef} className={styles.wrap} onFocus={() => setFocused(true)} onBlur={onBlur}>
      <OrgSwitchMenu {...props} legacy={legacy} open={open} setOpen={setOpen} wrapRef={wrapRef} />
    </div>
  );
}

interface MenuState {
  legacy: boolean;
  open: boolean;
  setOpen(open: boolean): void;
  wrapRef: RefObject<HTMLDivElement | null>;
}

function OrgSwitchMenu({
  current,
  orgs,
  platformAdmin,
  list,
  orgHref,
  createHref,
  projectsHref,
  settingsHref,
  platformHref,
  manageHref,
  scope = 'org',
  legacy,
  open,
  setOpen,
  wrapRef,
}: OrgSwitchProps & MenuState) {
  const inPlatform = scope === 'platform';
  const listed = list !== undefined;
  const shown = current ?? (orgs.length === 1 ? orgs[0] : undefined);
  const orgShown = inPlatform ? undefined : shown;
  const orgLinks = orgShown !== undefined && (projectsHref !== undefined || settingsHref !== undefined);
  const canSwitch = orgs.length > 1 || platformAdmin;
  const buttonLabel = listed
    ? 'Switch scope'
    : inPlatform
      ? 'Switch scope, currently Platform'
      : shown
        ? `Switch scope, currently organization ${shown.name}`
        : 'Switch scope, currently no organization';
  // With organizations but none shown (a not-found page), the place reads "Organization"; "No organization" is for none at all.
  const buttonText = inPlatform
    ? 'Platform'
    : listed
      ? 'Organization'
      : (shown?.name ?? (orgs.length > 0 ? 'Organization' : 'No organization'));
  const menuId = useId();

  // Outside press, ArrowDown on the button and the arrow keys inside the popover; Escape and focus return stay with the Popover.
  const { onTriggerKeyDown, onMenuKeyDown } = useMenuNav(open, setOpen, wrapRef, !listed);

  const close = () => setOpen(false);
  const orgGroup = (
    <div role="group" aria-label="Switch organization" className={styles.group}>
      {orgs.map((org) => {
        const isCurrent = !inPlatform && org.id === current?.id;
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
  );
  const sections: { key: string; node: ReactNode }[] = [];
  if (!legacy) {
    if (platformHref !== undefined) {
      sections.push({
        key: 'platform',
        node: (
          <AppLink
            href={platformHref}
            className={`${styles.item} ${inPlatform ? styles.current : ''}`}
            aria-current={inPlatform ? 'true' : undefined}
            onClick={close}
          >
            <span className={styles.itemName}>Platform</span>
            {inPlatform && (
              <span className={styles.check}>
                <Icon name="check" size={14} />
              </span>
            )}
          </AppLink>
        ),
      });
    }
    if (list?.status === 'loading') {
      sections.push({
        key: 'list',
        node: (
          <div className={styles.note} aria-busy="true">
            <span role="status" className="sr-only">
              Loading organizations
            </span>
            <Skeleton variant="text" lines={3} width={220} />
          </div>
        ),
      });
    } else if (list?.status === 'error') {
      sections.push({
        key: 'list',
        node: (
          <div className={styles.note}>
            <span role="alert">Could not load your organizations.</span>
            <Button size="sm" onClick={list.onRetry}>
              Retry
            </Button>
          </div>
        ),
      });
    } else if (orgs.length === 0) {
      if (!platformAdmin && platformHref === undefined) {
        sections.push({ key: 'list', node: <div className={styles.note}>No organization</div> });
      }
    } else {
      sections.push({ key: 'list', node: orgGroup });
    }
    if (platformAdmin) {
      sections.push({
        key: 'create',
        node: (
          <AppLink href={createHref} className={styles.item} onClick={close}>
            <span className={styles.itemName}>Create organization</span>
          </AppLink>
        ),
      });
    }
  }
  return (
    <>
      <button
        type="button"
        className={styles.switch}
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.name} title={inPlatform || listed ? undefined : shown?.name}>
          {buttonText}
        </span>
        <Icon name="chevron-down" />
      </button>
      <Popover
        open={open}
        label="Scope"
        onClose={close}
        onKeyDown={onMenuKeyDown}
        style={{ top: 'calc(100% + 6px)', left: 0, padding: 0, gap: 0 }}
      >
        {legacy ? (
          <div id={menuId} className={styles.menu}>
            {platformHref !== undefined && (
              <div role="group" aria-label="Platform" className={styles.group}>
                <div className={styles.groupLabel} aria-hidden="true">
                  Platform
                </div>
                <AppLink
                  href={platformHref}
                  className={`${styles.item} ${inPlatform ? styles.current : ''}`}
                  aria-current={inPlatform ? 'true' : undefined}
                  onClick={close}
                >
                  <span className={styles.itemName}>Platform admin</span>
                  {inPlatform && (
                    <span className={styles.check}>
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </AppLink>
                {manageHref !== undefined && !inPlatform && (
                  <AppLink href={manageHref} className={styles.item} onClick={close}>
                    <span className={styles.itemName}>Manage this org in Platform</span>
                  </AppLink>
                )}
              </div>
            )}
            {orgShown && (
              <>
                {platformHref !== undefined && <div className={styles.divider} role="separator" />}
                <div role="heading" aria-level={2} className={styles.heading} title={orgShown.name}>
                  {orgShown.name}
                </div>
                {projectsHref !== undefined && (
                  <AppLink href={projectsHref} className={styles.item} onClick={close}>
                    <Icon name="grid" size={15} />
                    <span className={styles.itemName}>Projects</span>
                  </AppLink>
                )}
                {settingsHref !== undefined && (
                  <AppLink href={settingsHref} className={styles.item} onClick={close}>
                    <Icon name="sliders" size={15} />
                    <span className={styles.itemName}>Org settings</span>
                  </AppLink>
                )}
              </>
            )}
            {canSwitch && orgs.length > 0 && (
              <>
                {(platformHref !== undefined || orgLinks) && <div className={styles.divider} role="separator" />}
                <div role="group" aria-label="Switch organization" className={styles.group}>
                  <div className={styles.groupLabel} aria-hidden="true">
                    Switch organization
                  </div>
                  {orgs.map((org) => {
                    const isCurrent = !inPlatform && org.id === current?.id;
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
            {platformAdmin && (
              <>
                {(platformHref !== undefined || orgShown !== undefined || orgs.length > 0) && (
                  <div className={styles.divider} role="separator" />
                )}
                <AppLink href={createHref} className={styles.item} onClick={close}>
                  <span className={styles.itemName}>Create organization</span>
                </AppLink>
              </>
            )}
          </div>
        ) : (
          <div id={menuId} className={styles.menu}>
            {sections.map((section, i) => (
              <Fragment key={section.key}>
                {i > 0 && <div className={styles.divider} role="separator" />}
                {section.node}
              </Fragment>
            ))}
          </div>
        )}
      </Popover>
    </>
  );
}
