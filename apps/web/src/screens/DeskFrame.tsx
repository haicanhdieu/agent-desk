import type { ReactNode } from 'react';
import {
  DESK_CRUMB,
  DeskLayout,
  PageHeader,
  TopBar,
  useShellOwnsChrome,
  type OrgSwitchProps,
  type ProjectSwitchMenu,
} from '@/components';
import { Banner, Button, Icon } from '@/ds';
import type { Actor, ConnectionStatus } from '@/mocks/types';
import styles from './Screens.module.css';

/** In-app hrefs of the top bar and Desk navigation. */
export interface DeskLinks {
  projects: string;
  runs: string;
  /** The top bar's Settings tab; hidden without it. */
  desk?: string;
  /** Desk nav items; each is hidden without its link. */
  skills?: string;
  rules?: string;
  agent?: string;
  /** Desk Setup tab; the nav item is hidden without it. */
  setup?: string;
  /** Access group items; each is hidden without its link. */
  members?: string;
  audit?: string;
}

/** A warning above the Desk boards (workspace setup, spec §5.5). It never blocks anything. */
export interface FrameWarning {
  title: string;
  detail: string;
  /** Where the details are (the Desk Setup tab). */
  href?: string;
}

/** What the frame shows around every Desk board: the user, the project and its connection, and the nav links. */
export interface DeskFrameData {
  user: Actor;
  /** `org` is the repository owner; `repo` is "owner/name". */
  project: { org: string; name: string; repo: string; needsYou: number };
  connection: ConnectionStatus;
  /** Defaults to the relative hrefs of the prototype ("/runs", "skills", …). */
  links?: DeskLinks;
  /** The project menu behind the top bar's switcher. */
  projectMenu?: ProjectSwitchMenu;
  /** The org crumb of the top bar. */
  org?: OrgSwitchProps;
  /** Shown above every board but the Setup tab, which has its own last-test banner. */
  warning?: FrameWarning;
}

/** The setup warning, drawn in a banner with "Open workspace setup" when the warning has a link. */
export function SetupWarningBanner({ warning }: { warning: FrameWarning }) {
  return (
    <Banner
      tone="warn"
      icon={<Icon name="warning" size={16} />}
      title={warning.title}
      centered
      actions={
        warning.href ? (
          <Button size="sm" href={warning.href}>
            Open workspace setup
          </Button>
        ) : undefined
      }
    >
      {warning.detail}
    </Banner>
  );
}

/** Top bar plus the Desk sub navigation shared by the Desk boards. Children render in the content column. */
export function DeskFrame({
  active,
  user,
  project,
  connection,
  links,
  projectMenu,
  org,
  warning,
  title,
  meta,
  actions,
  fill,
  children,
}: DeskFrameData & {
  active: 'skills' | 'rules' | 'agent' | 'setup' | 'members' | 'audit';
  /** In the shell: the page title (h1). Without it the page draws no header. */
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** In the shell: the page fills the height and its panels scroll inside it. */
  fill?: boolean;
  children?: ReactNode;
}) {
  const owned = useShellOwnsChrome();
  if (owned) {
    // The shell draws the bar and the menu: the frame is only the page's `main`, its header and the body.
    const banner = warning && active !== 'setup' ? <SetupWarningBanner warning={warning} /> : undefined;
    return (
      <main className={fill ? styles.shellMainFill : styles.shellMain}>
        {title !== undefined ? <PageHeader title={title} meta={meta} actions={actions} banner={banner} /> : banner}
        {children}
      </main>
    );
  }
  return (
    <>
      <TopBar
        variant="project"
        crumbs={[{ label: 'Project settings', href: links?.desk }, { label: DESK_CRUMB[active] }]}
        active="desk"
        user={user}
        org={org}
        needsYou={project.needsYou}
        project={{ name: project.name, repoUrl: `https://github.com/${project.repo}` }}
        links={links}
        projectMenu={projectMenu}
      />
      <DeskLayout
        active={active}
        projectName={project.name}
        repo={{
          org: project.org,
          name: project.name,
          branch: 'main',
          connected: connection.tone !== 'err',
          status: connection,
        }}
        links={links}
      >
        {warning && active !== 'setup' && (
          <div className={styles.deskWarning}>
            <SetupWarningBanner warning={warning} />
          </div>
        )}
        {children}
      </DeskLayout>
    </>
  );
}
