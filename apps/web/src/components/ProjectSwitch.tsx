import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useMenuNav } from './useMenuNav';
import { AppLink, Button, CountBadge, Icon, InlineStatus, Popover, Skeleton } from '@/ds';
import styles from './Chrome.module.css';

/** What the switcher menu shows: the projects, or why it has none yet. */
export type ProjectSwitchMenu = (
  { status: 'loading' } | { status: 'error'; onRetry?(): void } | { status: 'ready'; items: ProjectMenuProps['items'] }
) & {
  /** Called when the menu opens, so the list can be fetched lazily. */
  onOpen?(): void;
};

export interface ProjectSwitchProps {
  project: string;
  onClick?(): void;
  /** Without it the button is inert (static boards); with it the button opens the project menu. */
  menu?: ProjectSwitchMenu;
}

interface SwitchButtonProps extends Pick<ProjectSwitchProps, 'project' | 'onClick'> {
  buttonRef?: Ref<HTMLButtonElement>;
  expanded?: boolean;
  controls?: string;
  onKeyDown?(e: KeyboardEvent<HTMLButtonElement>): void;
}

function SwitchButton({ project, onClick, buttonRef, expanded, controls, onKeyDown }: SwitchButtonProps) {
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
      <span className={styles.name} title={project}>
        {project}
      </span>
      <Icon name="chevron-down" />
    </button>
  );
}

export function ProjectSwitch({ project, onClick, menu }: ProjectSwitchProps) {
  if (!menu) return <SwitchButton project={project} onClick={onClick} />;
  return <ProjectSwitchWithMenu project={project} menu={menu} />;
}

function ProjectSwitchWithMenu({ project, menu }: { project: string; menu: ProjectSwitchMenu }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { onOpen } = menu;

  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);

  // Outside press, ArrowDown on the button and the arrow keys inside the popover; Escape and focus return stay with the Popover.
  const { onTriggerKeyDown, onMenuKeyDown } = useMenuNav(open, setOpen, wrapRef, menu.status === 'ready');

  return (
    <div ref={wrapRef} className={styles.switchWrap}>
      <SwitchButton
        project={project}
        expanded={open}
        controls={menuId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
      />
      <Popover
        open={open}
        label="Projects"
        onClose={() => setOpen(false)}
        onKeyDown={onMenuKeyDown}
        style={{ top: 'calc(100% + 6px)', left: 0, padding: 0, gap: 0 }}
      >
        {/* The Popover is the dialog and handles the arrow keys; this wrapper carries the id. */}
        <div id={menuId}>
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
