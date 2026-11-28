import type { ReactNode } from 'react';
import { PageHeader } from '@/components';
import { Banner, Button, Icon } from '@/ds';
import type { ConnectionStatus } from '@/mocks/types';
import styles from './Screens.module.css';

/** A warning above the Desk boards (workspace setup, spec §5.5). It never blocks anything. */
export interface FrameWarning {
  title: string;
  detail: string;
  /** Where the details are (the Desk Setup tab). */
  href?: string;
}

/** What every Desk page shows about its project: the project, its connection and the setup warning. */
export interface DeskFrameData {
  /** `org` is the repository owner; `repo` is "owner/name". */
  project: { org: string; name: string; repo: string; needsYou: number };
  connection: ConnectionStatus;
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

/** The page of a Desk board: its one `main`, with the header when it has a title. Children render in the content column. */
export function DeskFrame({
  active,
  warning,
  title,
  meta,
  actions,
  fill,
  children,
}: {
  /** Shown above the header; not on the Setup tab, which has its own last-test banner. */
  warning?: FrameWarning;
  active: 'skills' | 'rules' | 'agent' | 'setup' | 'members' | 'audit';
  /** In the shell: the page title (h1). Without it the page draws no header. */
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** In the shell: the page fills the height and its panels scroll inside it. */
  fill?: boolean;
  children?: ReactNode;
}) {
  // The shell draws the bar and the menu: the frame is only the page's `main`, its header and the body.
  const banner = warning && active !== 'setup' ? <SetupWarningBanner warning={warning} /> : undefined;
  return (
    <main className={fill ? styles.shellMainFill : styles.shellMain}>
      {title !== undefined ? <PageHeader title={title} meta={meta} actions={actions} banner={banner} /> : banner}
      {children}
    </main>
  );
}
