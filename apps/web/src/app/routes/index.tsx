import { createFileRoute, redirect } from '@tanstack/react-router';
import { EmptyState } from '@/components';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import styles from '../boundaries.module.css';

// `/` opens the active org's projects (the root guard has already sent signed-out visitors to sign-in).
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: { queryClient } }) => {
    const [session, orgs] = await Promise.all([
      queryClient.ensureQueryData(sessionQuery),
      queryClient.ensureQueryData(orgsQuery),
    ]);
    const org = orgs.find((o) => o.id === session?.activeOrganizationId) ?? orgs[0];
    // `href` until the projects route exists (Task 6); then `to: '/o/$org/projects'`.
    if (org) throw redirect({ href: `/o/${encodeURIComponent(org.slug)}/projects` });
  },
  component: NoOrganization,
});

/** A signed-in user who belongs to no organization yet. */
function NoOrganization() {
  return (
    <div className={styles.page}>
      <EmptyState title="Agent Desk" body="You are not a member of any organization yet." />
    </div>
  );
}
