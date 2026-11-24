import { AppLink, Button, Icon } from '@/ds';
import type { OrgStatusView } from '@/mocks/platform/orgs';
import { OrgStatus } from './OrgStatus';
import styles from './PlatformOrgHeader.module.css';

export interface PlatformOrgHeaderProps {
  name: string;
  slug: string;
  status: OrgStatusView;
  auditHref: string;
  /** The member's own page of this org. Absent for an org the person does not belong to: no "Open organization" link. */
  openHref?: string;
  onSuspend: () => void;
  onReactivate: () => void;
  /** Absent: no "Edit organization" button. */
  onEdit?: () => void;
}

/** Header of a platform org detail page: name, slug, status and the actions. Text only, never HTML. */
export function PlatformOrgHeader({
  name,
  slug,
  status,
  auditHref,
  openHref,
  onSuspend,
  onReactivate,
  onEdit,
}: PlatformOrgHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.title}>
        <h1 className={styles.h1} tabIndex={-1}>
          {name}
        </h1>
        <div className={styles.meta}>
          <span className={styles.slug}>/o/{slug}</span>
          <OrgStatus status={status} />
        </div>
      </div>
      <div className={styles.actions}>
        {onEdit && <Button onClick={onEdit}>Edit organization</Button>}
        {status === 'active' ? (
          <Button variant="danger" onClick={onSuspend}>
            Suspend organization
          </Button>
        ) : (
          <Button onClick={onReactivate}>Reactivate organization</Button>
        )}
        <AppLink href={auditHref}>View audit log</AppLink>
        {openHref !== undefined && (
          <AppLink href={openHref} className={styles.open}>
            Open organization
            <Icon name="external" size={13} />
          </AppLink>
        )}
      </div>
    </div>
  );
}
