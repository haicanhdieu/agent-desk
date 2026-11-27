import { useCallback, useMemo, useState } from 'react';
import {
  AppShell,
  ShellContext,
  TopBar,
  type AppShellProps,
  type ShellContextValue,
  type TopBarProps,
} from '@/components';

/** Stories only: the shell around a screen, with the context that tells the screen to draw only its page. */
export function ShellFrame({
  topBar,
  wizard,
  fill,
  height,
  menuMode,
  wizardSlotRef,
  children,
  ...rest
}: Omit<AppShellProps, 'topBar'> & { topBar: TopBarProps; wizard?: boolean; fill?: boolean }) {
  const [wizardSlot, setWizardSlot] = useState<HTMLElement | null>(null);
  const value = useMemo<ShellContextValue>(
    () => ({ owned: true, wizardSlot, reportPageState: () => () => {} }),
    [wizardSlot],
  );
  const slotRef = useCallback(
    (el: HTMLElement | null) => {
      setWizardSlot(el);
      wizardSlotRef?.(el);
    },
    [wizardSlotRef],
  );
  return (
    <ShellContext.Provider value={value}>
      <AppShell
        {...rest}
        height={height ?? (fill ? 'viewport' : undefined)}
        menuMode={wizard ? 'wizard' : menuMode}
        wizardSlotRef={slotRef}
        topBar={<TopBar {...topBar} crumbs={topBar.crumbs} />}
      >
        {children}
      </AppShell>
    </ShellContext.Provider>
  );
}
