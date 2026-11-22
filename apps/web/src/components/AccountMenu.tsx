import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { AppLink, Avatar, CountBadge, Icon, Popover } from '@/ds';
import type { Actor } from '@/mocks/types';
import styles from './AccountMenu.module.css';

const SignOutContext = createContext<(() => void) | undefined>(undefined);

/** Supplies the sign-out action behind the top bar's account menu (the app passes the real flow; stories pass a stub). */
export function SignOutProvider({ onSignOut, children }: { onSignOut: () => void; children: ReactNode }) {
  return <SignOutContext.Provider value={onSignOut}>{children}</SignOutContext.Provider>;
}

/** What the account menu says about the signed-in person beyond the handle every top bar already has. */
export interface AccountInfo {
  /** Display name, shown above the handle; the handle stands in when the session has none. */
  name?: string;
  /** Pending invitations to this person, shown as a count on My invitations; none shows no count. */
  pendingInvitations?: number;
  /** Called when the menu opens, so the count can be fetched lazily (keep it stable between renders). */
  onOpen?(): void;
}

const AccountInfoContext = createContext<AccountInfo>({});

/** Supplies the name and pending-invitation count behind the account menu (the app reads them from the session). */
export function AccountInfoProvider({ children, ...info }: AccountInfo & { children: ReactNode }) {
  const { name, pendingInvitations, onOpen } = info;
  return (
    <AccountInfoContext.Provider value={{ name, pendingInvitations, onOpen }}>{children}</AccountInfoContext.Provider>
  );
}

export interface AccountMenuProps {
  user: Actor;
}

/**
 * The user's avatar in the top bar. With a sign-out action in context it is a button opening the account menu
 * (identity, My invitations, Logout); without one (static boards) it stays a plain avatar.
 */
export function AccountMenu({ user }: AccountMenuProps) {
  const onSignOut = useContext(SignOutContext);
  const avatar = <Avatar initials={user.initials} kind={user.bot ? 'bot' : 'user'} title={user.login} />;
  if (!onSignOut) return avatar;
  return <AccountMenuButton login={user.login} avatar={avatar} onSignOut={onSignOut} />;
}

const MENU_ITEMS = 'a[href],button:not([disabled])';
const ARROW_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

function AccountMenuButton({ login, avatar, onSignOut }: { login: string; avatar: ReactNode; onSignOut: () => void }) {
  const { name, pendingInvitations = 0, onOpen } = useContext(AccountInfoContext);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (open) onOpen?.();
  }, [open, onOpen]);

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

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Account menu for ${login}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
      >
        {avatar}
      </button>
      <Popover
        open={open}
        id={menuId}
        role="menu"
        label="Account"
        width={240}
        onClose={() => setOpen(false)}
        style={{ top: 'calc(100% + 8px)', right: 0, padding: 0, gap: 0 }}
      >
        {/* The Popover is the menu (it carries the id); this wrapper handles the arrow keys. */}
        <div className={styles.menu} onKeyDown={onMenuKeyDown}>
          <span className={styles.who} role="presentation">
            <b className={styles.name} title={name ?? login}>
              {name || login}
            </b>
            <span className="mono faint">{login}</span>
          </span>
          <AppLink href="/invitations" className={styles.item} role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="mail" size={15} />
            <span>My invitations</span>
            {pendingInvitations > 0 && (
              <span className={styles.count}>
                <CountBadge count={pendingInvitations} label="pending" title={`${pendingInvitations} pending`} />
              </span>
            )}
          </AppLink>
          <div role="separator" className={styles.separator} />
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Logout
          </button>
        </div>
      </Popover>
    </div>
  );
}
