import { createFileRoute, redirect } from '@tanstack/react-router';
import { EmptyState } from '@/components';
import { landingOrg } from '@/features/auth/session';
import styles from '../boundaries.module.css';

// `/` opens the active org's projects (the root guard has already sent signed-out visitors to sign-in).
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context: { queryClient } }) => {
    const org = await landingOrg(queryClient);
    if (org) throw redirect({ to: '/o/$org/projects', params: { org: org.slug } });
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
