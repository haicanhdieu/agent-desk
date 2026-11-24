import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { Forbidden, NotFound } from '@/app/boundaries';
import { NO_PAGE_CRUMBS, ORG_SETTINGS_CRUMB, OrgSettingsLayout, TopBar } from '@/components';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgSettingsTabs, useAppBar } from '@/features/chrome/appBar';
import type { OrgSettingsTabKey } from '@/mocks/types';

// Settings area: the org top bar and the side menu with the tabs the caller may open. Without any tab: the bar and
// the no-access state, no side menu. Access only shows or hides UI here; the API refuses each action (ADR-0036).
export const Route = createFileRoute('/o/$org/settings')({
  component: SettingsLayout,
  // An unknown tab (or one not built yet) keeps the bar and the side menu.
  notFoundComponent: NotFound,
});

const TAB_KEYS: readonly OrgSettingsTabKey[] = ['general', 'members', 'invitations', 'audit'];

function useActiveTab(): OrgSettingsTabKey | null {
  const segment = useRouterState({ select: (s) => /^\/o\/[^/]+\/settings\/([^/]+)/.exec(s.location.pathname)?.[1] });
  return TAB_KEYS.find((key) => key === segment) ?? null;
}

function SettingsLayout() {
  const { org } = Route.useParams();
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const bar = useAppBar(org);
  const active = useActiveTab();
  const tabs = orgSettingsTabs(org, toAccess(accessDto));
  const hasTabs = Object.keys(tabs).length > 0;
  return (
    <>
      <TopBar
        variant="global"
        crumbs={
          hasTabs
            ? [
                { label: 'Org settings', href: `/o/${encodeURIComponent(org)}/settings` },
                ...(active ? [{ label: ORG_SETTINGS_CRUMB[active] }] : []),
              ]
            : NO_PAGE_CRUMBS
        }
        {...(!hasTabs && { state: 'forbidden' as const })}
        user={bar.user}
        org={bar.org}
        tabs="org"
        {...(hasTabs && { active: 'settings' as const })}
        links={{ projects: `/o/${encodeURIComponent(org)}/projects` }}
      />
      {hasTabs ? (
        <OrgSettingsLayout tabs={tabs} active={active}>
          <Outlet />
        </OrgSettingsLayout>
      ) : (
        <Forbidden titled={false} />
      )}
    </>
  );
}
