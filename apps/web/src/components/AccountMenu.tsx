import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Avatar, Popover } from '@/ds';
import type { Actor } from '@/mocks/types';
import styles from './AccountMenu.module.css';

const SignOutContext = createContext<(() => void) | undefined>(undefined);

/** Supplies the sign-out action behind the top bar's account menu (the app passes the real flow; stories pass a stub). */
export function SignOutProvider({ onSignOut, children }: { onSignOut: () => void; children: ReactNode }) {
  return <SignOutContext.Provider value={onSignOut}>{children}</SignOutContext.Provider>;
}

export interface AccountMenuProps {
  user: Actor;
}

/**
 * The user's avatar in the top bar. With a sign-out action in context it is a button opening a popover with Logout;
 * without one (static boards) it stays a plain avatar.
 */
export function AccountMenu({ user }: AccountMenuProps) {
  const onSignOut = useContext(SignOutContext);
  const avatar = <Avatar initials={user.initials} kind={user.bot ? 'bot' : 'user'} title={user.login} />;
  if (!onSignOut) return avatar;
  return <AccountMenuButton login={user.login} avatar={avatar} onSignOut={onSignOut} />;
}

function AccountMenuButton({ login, avatar, onSignOut }: { login: string; avatar: ReactNode; onSignOut: () => void }) {
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

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`Account menu for ${login}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {avatar}
      </button>
      <Popover
        open={open}
        label="Account"
        onClose={() => setOpen(false)}
        style={{ top: 'calc(100% + 6px)', right: 0, padding: 0, gap: 0 }}
      >
        <div id={menuId} role="menu" className={styles.menu}>
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
