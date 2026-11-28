import { createContext, useContext, useEffect } from 'react';
import type { PageState } from './pageTitle';

/** A page state the shell host may need to know about: the fixed ones, plus an in-page error or load and a suspended org. */
export type ShellPageState = PageState | 'error' | 'loading' | 'suspended';

export interface ShellContextValue {
  /** Where the setup wizard draws its steps menu (inline or inside the drawer); null while there is none. */
  wizardSlot: HTMLElement | null;
  /** Tells the shell what the page shows; returns the undo, which the page calls when it stops showing it. */
  reportPageState(state: ShellPageState): () => void;
  /** Where "Go to projects" leads from this page: the shown menu's org, else the landing page. Absent without a shell. */
  goToProjectsHref?: string;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

/** The "Go to projects" address the shell computed for the page, if a shell owns it. */
export function useGoToProjectsHref(): string | undefined {
  return useContext(ShellContext)?.goToProjectsHref;
}

/** Reports the page state to the shell while mounted. `undefined` reports nothing; without a shell it does nothing. */
export function useReportPageState(state: ShellPageState | undefined): void {
  const shell = useContext(ShellContext);
  useEffect(() => {
    if (!shell || state === undefined) return;
    return shell.reportPageState(state);
  }, [shell, state]);
}
