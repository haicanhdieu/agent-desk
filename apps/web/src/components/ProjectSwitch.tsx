import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { AppLink, Button, CountBadge, Icon, InlineStatus, Popover, Skeleton } from '@/ds';
import styles from './Chrome.module.css';

/** What the switcher menu shows: the projects, or why it has none yet. */
export type ProjectSwitchMenu =
  { status: 'loading' } | { status: 'error'; onRetry?(): void } | { status: 'ready'; items: ProjectMenuProps['items'] };

export interface ProjectSwitchProps {
  org: string;
  project: string;
  onClick?(): void;
  /** Without it the button is inert (static boards); with it the button opens the project menu. */
  menu?: ProjectSwitchMenu;
}

interface SwitchButtonProps extends Pick<ProjectSwitchProps, 'org' | 'project' | 'onClick'> {
  buttonRef?: Ref<HTMLButtonElement>;
  expanded?: boolean;
  controls?: string;
  onKeyDown?(e: KeyboardEvent<HTMLButtonElement>): void;
}

function SwitchButton({ org, project, onClick, buttonRef, expanded, controls, onKeyDown }: SwitchButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={styles.switch}
      aria-label={`Switch project, currently ${project}`}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className={styles.org}>{org} /</span>
      <span className={styles.name} title={project}>
        {project}
      </span>
      <Icon name="chevron-down" />
    </button>
  );
}

const MENU_ITEMS = 'a[href],button:not([disabled])';
const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

export function ProjectSwitch({ org, project, onClick, menu }: ProjectSwitchProps) {
  if (!menu) return <SwitchButton org={org} project={project} onClick={onClick} />;
  return <ProjectSwitchWithMenu org={org} project={project} menu={menu} />;
}

function ProjectSwitchWithMenu({ org, project, menu }: { org: string; project: string; menu: ProjectSwitchMenu }) {
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

  // Arrow keys, Home and End move between the menu's links (and Retry).
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

  return (
    <div ref={wrapRef} className={styles.switchWrap}>
      <SwitchButton
        org={org}
        project={project}
        expanded={open}
        controls={menuId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
      />
      <Popover
        open={open}
        label="Projects"
        onClose={() => setOpen(false)}
        style={{ top: 'calc(100% + 6px)', left: 0, padding: 0, gap: 0 }}
      >
        {/* The Popover is the dialog; this wrapper carries the id and the arrow-key handling. */}
        <div id={menuId} onKeyDown={onMenuKeyDown}>
          <SwitchMenuBody menu={menu} onNavigate={() => setOpen(false)} />
        </div>
      </Popover>
    </div>
  );
}

function SwitchMenuBody({ menu, onNavigate }: { menu: ProjectSwitchMenu; onNavigate(): void }) {
  if (menu.status === 'loading') {
    return (
      <div className={styles.menuNote} aria-busy="true">
        <span role="status" className="sr-only">
          Loading projects
        </span>
        <Skeleton variant="text" lines={3} width={220} />
      </div>
    );
  }
  if (menu.status === 'error') {
    return (
      <div className={styles.menuNote}>
        <span role="alert">Could not load your projects.</span>
        {menu.onRetry && (
          <Button size="sm" onClick={menu.onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  if (menu.items.length === 0) {
    return (
      <div className={styles.menuNote}>
        <span>No projects yet.</span>
      </div>
    );
  }
  return <ProjectMenu items={menu.items} onNavigate={onNavigate} />;
}

export interface ProjectMenuProps {
  items: {
    name: string;
    needsYou: number;
    /** Short connection warning, e.g. "webhooks" (silent webhook) or "polling" (polling failed). */
    warning?: string;
    /** idle (amber) for a silent webhook, err (red) for a polling error. */
    warningTone?: 'idle' | 'err';
    current?: boolean;
    href: string;
  }[];
  /** Called when a project link is followed, so a surrounding popover can close. */
  onNavigate?(): void;
}

export function ProjectMenu({ items, onNavigate }: ProjectMenuProps) {
  return (
    <div className={styles.menu}>
      {items.map((it) => (
        <AppLink
          key={it.name}
          href={it.href}
          className={`${styles.menuItem} ${it.current ? styles.current : ''}`}
          aria-current={it.current ? 'true' : undefined}
          onClick={onNavigate}
        >
          <span className={styles.menuName} title={it.name}>
            {it.name}
          </span>
          <span className={styles.grow} />
          {it.warning ? (
            <InlineStatus tone={it.warningTone ?? 'idle'} icon={<Icon name="warning" size={12} />}>
              {it.warning}
            </InlineStatus>
          ) : it.needsYou > 0 ? (
            <CountBadge count={it.needsYou} />
          ) : (
            <span className={styles.menuZero}>0</span>
          )}
        </AppLink>
      ))}
    </div>
  );
}
