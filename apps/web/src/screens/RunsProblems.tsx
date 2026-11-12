import { Banner, Button, Icon, type IconName } from '@/ds';
import { DataTable, EmptyState, IgnoredRow } from '@/components';
import type { IgnoredCommand } from '@/mocks/types';
import { RunsPage, type RunsPageProps } from './RunsPage';
import styles from './Screens.module.css';

export interface RunsProblemsWarning {
  tone: 'err' | 'warn';
  icon: IconName;
  title: string;
  body: string;
  actions: {
    label: string;
    href?: string;
    icon?: IconName;
    variant?: 'default' | 'primary' | 'ghost';
    /** For actions without an href (e.g. "Check again"). */
    onClick?(): void;
  }[];
}

export interface RunsProblemsProps extends Omit<RunsPageProps, 'children' | 'banners' | 'filter'> {
  filter?: 'ignored';
  warnings: RunsProblemsWarning[];
  ignored: IgnoredCommand[];
}

const columns = [
  { key: 'time', header: 'Time', width: 80 },
  { key: 'ticket', header: 'Ticket' },
  { key: 'command', header: 'Command' },
  { key: 'author', header: 'Author' },
  { key: 'why', header: 'Why nothing ran' },
  { key: 'actions', header: <span className="sr-only">Actions</span> },
];

export function RunsProblems({ warnings, ignored, filter = 'ignored', ...page }: RunsProblemsProps) {
  return (
    <RunsPage
      {...page}
      filter={filter}
      banners={warnings.map((w) => (
        <Banner
          key={w.title}
          tone={w.tone}
          icon={<Icon name={w.icon} size={16} />}
          title={w.title}
          actions={w.actions.map((a) => (
            <Button key={a.label} variant={a.variant} icon={a.icon} href={a.href} onClick={a.onClick}>{a.label}</Button>
          ))}
        >
          {w.body}
        </Banner>
      ))}
    >
      <div className={styles.stack6}>
        <h2>Ignored commands</h2>
        <p className={`muted ${styles.helpLine13}`}>
          Comments that looked like a command but started nothing, last 7 days. Nothing was posted on GitHub for these.
        </p>
      </div>
      {ignored.length === 0 ? (
        <EmptyState title="No ignored commands" />
      ) : (
        <DataTable columns={columns}>
          {ignored.map((item, i) => <IgnoredRow key={`${i}-${item.at}-${item.ticket.number}-${item.command}`} item={item} />)}
        </DataTable>
      )}
    </RunsPage>
  );
}
