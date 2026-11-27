import { createContext, useContext, useEffect } from 'react';
import type { PageState } from './pageTitle';

/** A page state the shell host may need to know about: the fixed ones, plus an in-page error or load. */
export type ShellPageState = PageState | 'error' | 'loading';

export interface ShellContextValue {
  /** True when a shell around the page draws the top bar, the side menu and the layout. */
  owned: boolean;
  /** Where the setup wizard draws its steps menu (inline or inside the drawer); null while there is none. */
  wizardSlot: HTMLElement | null;
  /** Tells the shell what the page shows; returns the undo, which the page calls when it stops showing it. */
  reportPageState(state: ShellPageState): () => void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/** Whether a shell owns the chrome. A screen draws its own bar and layout only when this is false. */
export function useShellOwnsChrome(): boolean {
  return useContext(ShellContext)?.owned ?? false;
}

/** Reports the page state to the shell while mounted. `undefined` reports nothing; without a shell it does nothing. */
export function useReportPageState(state: ShellPageState | undefined): void {
  const shell = useContext(ShellContext);
  useEffect(() => {
    if (!shell || state === undefined) return;
    return shell.reportPageState(state);
  }, [shell, state]);
}
