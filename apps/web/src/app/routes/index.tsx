import { createFileRoute } from '@tanstack/react-router';
import { EmptyState } from '@/components';
import styles from '../boundaries.module.css';

// Until the session guard lands (task 5: `/` redirects to the active org's projects), the root shows the brand.
export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <div className={styles.page}>
      <EmptyState title="Agent Desk" />
    </div>
  );
}
