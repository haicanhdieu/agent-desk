import { IconButton, PHONE, useMediaQuery } from '@/ds';
import type { Actor } from '@/mocks/types';
import { AccountMenu } from './AccountMenu';
import { Brand } from './Brand';
import { OrgSwitch, type OrgSwitchProps } from './OrgSwitch';
import { ProjectSwitch, type ProjectSwitchMenu } from './ProjectSwitch';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import type { PageCrumb } from './pageTitle';
import styles from './Chrome.module.css';

export interface TopBarProps {
  user: Actor;
  /** Page crumbs after the scope and project crumbs; NO_PAGE_CRUMBS when the page has none. */
  crumbs: readonly PageCrumb[];
  /** The org crumb. */
  org?: OrgSwitchProps;
  /** The project crumb, with the menu behind its switcher button (without a menu the button does nothing). */
  projectName?: string;
  projectMenu?: ProjectSwitchMenu;
  /** Where the logo leads; "/projects" when absent. */
  logoHref?: string;
  /** Shows the "Open menu" button, which opens the side menu drawer. Absent: no button. */
  onOpenMenu?(): void;
  /** Whether the drawer is open (aria-expanded of the "Open menu" button). */
  menuOpen?: boolean;
}

function toItem(c: PageCrumb): BreadcrumbItem {
  if (c.loading) return { loading: `Loading ${c.what ?? 'page'}` };
  return c.href ? { label: c.label, href: c.href } : { label: c.label };
}

/** The 1px divider between top bar groups. */
export function TopBarSeparator() {
  return <span className={styles.sep} aria-hidden="true" />;
}

/** The slim bar: logo, scope and project switchers with the page crumbs, the disabled bell and the account menu. */
export function TopBar({
  user,
  crumbs,
  org,
  projectName,
  projectMenu,
  logoHref,
  onOpenMenu,
  menuOpen = false,
}: TopBarProps) {
  const phone = useMediaQuery(PHONE);

  const items: BreadcrumbItem[] = [];
  if (org) items.push({ control: <OrgSwitch {...org} /> });
  if (projectName !== undefined) items.push({ control: <ProjectSwitch project={projectName} menu={projectMenu} /> });
  items.push(...crumbs.map(toItem));

  return (
    <header className={`${styles.top} ${styles.topShell}`}>
      {onOpenMenu && <IconButton icon="menu" aria-label="Open menu" aria-expanded={menuOpen} onClick={onOpenMenu} />}
      <Brand withName={!phone} href={logoHref ?? '/projects'} />
      {items.length > 0 && (
        <>
          <span className={styles.sep} />
          <Breadcrumb items={items} />
        </>
      )}
      <span className={styles.grow} />
      <IconButton icon="bell" aria-label="Notifications (coming soon)" title="Notifications (coming soon)" disabled />
      <AccountMenu user={user} />
    </header>
  );
}
