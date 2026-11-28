import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppShell,
  OrgStatus,
  RepoBlock,
  ShellContext,
  SubNav,
  TopBar,
  pageTitle,
  useDocumentTitle,
  type MenuMode,
  type PageCrumb,
  type PageState,
  type ShellContextValue,
  type ShellPageState,
  type TopBarProps,
} from '@/components';
import { AppLink, BELOW_DESKTOP, useMediaQuery } from '@/ds';
import type { MenuModel } from '@/features/chrome/nav';
import type { RouteChrome } from '@/features/chrome/routeChrome';
import { sessionQuery } from '@/features/auth/session';
import { useShellData } from '@/features/chrome/useShellData';

interface Reported {
  id: number;
  state: ShellPageState;
}

function stringParam(params: object, key: string): string | undefined {
  const value: unknown = Reflect.get(params, key);
  return typeof value === 'string' ? value : undefined;
}

/** The deepest matched route's chrome and a key that changes with every entry to a route or a change of its params (never of the search). */
function useChrome(): {
  chrome: RouteChrome | undefined;
  entryKey: string;
  params: Record<string, string | undefined>;
} {
  return useRouterState({
    select: (s) => {
      const deepest = s.matches[s.matches.length - 1];
      return {
        chrome: deepest?.staticData.chrome,
        entryKey: deepest ? `${deepest.routeId}:${JSON.stringify(deepest.params)}` : '',
        params: {
          org: stringParam(deepest?.params ?? {}, 'org'),
          project: stringParam(deepest?.params ?? {}, 'project'),
          orgId: stringParam(deepest?.params ?? {}, 'orgId'),
          run: stringParam(deepest?.params ?? {}, 'run'),
        },
      };
    },
    structuralSharing: true,
  });
}

function menuHeader(header: MenuModel['header']): ReactNode {
  if (header === undefined) return undefined;
  if (header === 'loading') return <span role="status" aria-label="Loading organization" />;
  return (
    <div>
      <strong>{header.name}</strong>
      {header.status && <OrgStatus status={header.status} />}
    </div>
  );
}

function menuFooter(footer: MenuModel['footer']): ReactNode {
  if (footer === undefined) return undefined;
  if (footer.kind === 'managePlatform') return <AppLink href={footer.href}>Manage in Platform</AppLink>;
  return <RepoBlock {...footer.repo} />;
}

function focusMain() {
  const main = document.querySelector('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
  main.focus();
}

/** What a page owned only because it reports a state (no route chrome) gets: the standard shell with no item. */
const STANDARD_CHROME: RouteChrome = { mode: 'standard' };

const NO_REPORT = () => () => undefined;

/**
 * Draws the shell (top bar, side menu, drawer) around the page of a route that declares `staticData.chrome`; a route
 * without it gets only its content, unless its page reports a state (not found, forbidden, error, loading, suspended):
 * then the host owns the chrome too (mode standard, whatever the route declares), except under `mode: 'none'`. The
 * collapse choice lives here so it outlives navigation between pages.
 */
export function ShellHost({ children }: { children: ReactNode }) {
  const { chrome, entryKey, params } = useChrome();
  const [sharedCollapsed, setSharedCollapsed] = useState(false);

  // What the page reports (not found, forbidden, error, loading): the last report wins.
  const [reports, setReports] = useState<Reported[]>([]);
  const nextId = useRef(0);
  const reportPageState = useCallback((state: ShellPageState) => {
    const id = nextId.current++;
    setReports((prev) => [...prev, { id, state }]);
    return () => setReports((prev) => prev.filter((r) => r.id !== id));
  }, []);
  const pageState = reports[reports.length - 1]?.state;

  // The shell sits above the root session guard: until a session is known (loading, or signed out and about to be
  // sent to sign-in) nothing of it is drawn and none of its reads are sent.
  const signedIn = Boolean(useQuery(sessionQuery).data);
  const bare = chrome?.mode === 'none';
  const unownedValue = useMemo<ShellContextValue>(
    () => ({ wizardSlot: null, reportPageState: bare ? NO_REPORT : reportPageState }),
    [bare, reportPageState],
  );
  if (bare || !signedIn || (chrome === undefined && pageState === undefined)) {
    return <ShellContext.Provider value={unownedValue}>{children}</ShellContext.Provider>;
  }
  return (
    <OwnedShell
      chrome={chrome ?? STANDARD_CHROME}
      entryKey={entryKey}
      pageState={pageState}
      reportPageState={reportPageState}
      params={params}
      sharedCollapsed={sharedCollapsed}
      setSharedCollapsed={setSharedCollapsed}
    >
      {children}
    </OwnedShell>
  );
}

function OwnedShell({
  chrome,
  entryKey,
  pageState,
  reportPageState,
  params,
  sharedCollapsed,
  setSharedCollapsed,
  children,
}: {
  chrome: RouteChrome;
  entryKey: string;
  pageState: ShellPageState | undefined;
  reportPageState(state: ShellPageState): () => void;
  params: Record<string, string | undefined>;
  sharedCollapsed: boolean;
  setSharedCollapsed(update: (prev: boolean) => boolean): void;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locationHref = useRouterState({ select: (s) => s.location.href });
  const below = useMediaQuery(BELOW_DESKTOP);

  const [wizardSlot, setWizardSlot] = useState<HTMLElement | null>(null);

  // Collapse: one shared choice; a startCollapsed page keeps its own choice, reset on each entry.
  const [entry, setEntry] = useState({ key: entryKey, collapsed: true });
  if (entry.key !== entryKey) setEntry({ key: entryKey, collapsed: true });
  const wizard = chrome.mode === 'wizard';
  const ownChoice = chrome.startCollapsed === true;
  const collapsed = wizard ? false : ownChoice ? entry.collapsed : sharedCollapsed;
  const toggleCollapsed = () => {
    if (ownChoice) setEntry((prev) => ({ ...prev, collapsed: !prev.collapsed }));
    else setSharedCollapsed((prev) => !prev);
  };

  const data = useShellData({
    chrome,
    pathname,
    params: {
      ...(params.org !== undefined && { org: params.org }),
      ...(params.project !== undefined && { project: params.project }),
      ...(params.orgId !== undefined && { orgId: params.orgId }),
      ...(params.run !== undefined && { run: params.run }),
    },
    ...(pageState !== undefined && { pageState }),
  });

  const fixedState: PageState | undefined =
    pageState === 'notFound' || pageState === 'forbidden' ? pageState : undefined;
  // The bar and the shell are rendered below; this host alone owns the document title.
  useDocumentTitle(
    pageTitle({
      crumbs: data.crumbs,
      ...(data.titleScope !== undefined && { scope: data.titleScope }),
      ...(fixedState && { state: fixedState }),
    }),
  );

  // The drawer closes on any location change (a pick, history back) and when the window grows to 1024px.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenHref, setSeenHref] = useState(locationHref);
  // Set when a location change closed the drawer: main takes focus once the new page's main is in place.
  const [focusAfterClose, setFocusAfterClose] = useState<string | null>(null);
  if (seenHref !== locationHref) {
    setSeenHref(locationHref);
    if (drawerOpen) {
      setFocusAfterClose(entryKey);
      setDrawerOpen(false);
    } else if (focusAfterClose !== null) {
      setFocusAfterClose(null);
    }
  }
  if (drawerOpen && !below) setDrawerOpen(false);
  if (drawerOpen && focusAfterClose !== null) setFocusAfterClose(null);
  useEffect(() => {
    if (drawerOpen || focusAfterClose === null) return;
    focusMain();
    // Runs again when the entry key moves: until the new page has rendered, the old main may still be the one in the DOM.
  }, [drawerOpen, entryKey, focusAfterClose]);

  const menu = data.menu;
  const hasMenu = chrome.mode !== 'none' && menu !== null;
  const menuMode: MenuMode = wizard
    ? 'wizard'
    : !hasMenu
      ? 'none'
      : below
        ? 'drawer'
        : collapsed
          ? 'collapsed'
          : 'full';
  const inDrawer = menuMode === 'drawer' || (menuMode === 'wizard' && below);

  const subNav =
    hasMenu && !wizard ? (
      <SubNav
        aria-label={menu.label}
        groups={menu.groups}
        state={menu.state}
        onRetry={data.onRetryMenu}
        {...(menu.back && { back: menu.back })}
        {...(menu.header !== undefined && { header: menuHeader(menu.header) })}
        {...(menu.footer !== undefined && { footer: menuFooter(menu.footer) })}
        {...(below ? { onClose: () => setDrawerOpen(false) } : { collapsed, onToggleCollapsed: toggleCollapsed })}
      />
    ) : undefined;

  const value = useMemo<ShellContextValue>(
    () => ({ wizardSlot, reportPageState, goToProjectsHref: data.goToProjectsHref }),
    [wizardSlot, reportPageState, data.goToProjectsHref],
  );

  const crumbs: PageCrumb[] = data.projectPlaceholder
    ? [{ label: '', loading: true, what: 'project' }, ...data.crumbs]
    : data.crumbs;
  const topBar: TopBarProps = {
    user: data.user,
    crumbs,
    org: data.orgSwitch,
    ...(data.logoHref !== undefined && { logoHref: data.logoHref }),
    ...(data.projectSwitch !== undefined &&
      data.titleScope !== undefined && { projectName: data.titleScope, projectMenu: data.projectSwitch }),
    ...(inDrawer && { onOpenMenu: () => setDrawerOpen(true), menuOpen: drawerOpen }),
  };

  return (
    <ShellContext.Provider value={value}>
      <AppShell
        {...(chrome.fill && { height: 'viewport' as const })}
        topBar={<TopBar {...topBar} crumbs={topBar.crumbs} />}
        menu={subNav}
        menuMode={menuMode}
        drawerOpen={drawerOpen}
        onDrawerClose={() => setDrawerOpen(false)}
        wizardSlotRef={setWizardSlot}
      >
        {children}
      </AppShell>
    </ShellContext.Provider>
  );
}
