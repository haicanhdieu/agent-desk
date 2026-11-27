import type { ReactNode } from 'react';
import { Button, Icon, Banner, Skeleton } from '@/ds';
import type { AgentRowView } from '@/mocks/types';
import { AgentRow } from './AgentRow';
import { EmptyState } from './EmptyState';
import { Pagination, type PaginationProps } from './Pagination';
import styles from './AgentList.module.css';

export interface AgentListProps {
  rows: AgentRowView[];
  state: 'loading' | 'ready' | 'empty' | 'error';
  onRetry: () => void;
  pagination: PaginationProps;
  /** `error` state: the request id of the failed load. */
  error?: { requestId?: string };
  onAdd: () => void;
  onEdit: (agent: AgentRowView) => void;
  onTest: (agent: AgentRowView) => void;
  onSetDefault: (agent: AgentRowView) => void;
  onDelete: (agent: AgentRowView) => void;
  /** The row whose write is in flight. */
  busyId?: string;
  /** The row whose connection test runs. */
  testingId?: string;
  readOnly?: boolean;
  /** The first item of the scroll area (the setup warning in the shell). */
  lead?: ReactNode;
}

const SKELETON_ROWS = 3;

/** The Agents tab: heading, the default explained, Add agent, then the rows or their loading, empty and error state. */
export function AgentList({
  rows,
  state,
  onRetry,
  pagination,
  error,
  onAdd,
  onEdit,
  onTest,
  onSetDefault,
  onDelete,
  busyId,
  testingId,
  readOnly,
  lead,
}: AgentListProps) {
  const addAgent = (
    <Button variant="primary" icon="plus" onClick={onAdd}>
      Add agent
    </Button>
  );
  return (
    <section className={styles.list} aria-labelledby="agent-list-heading">
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 id="agent-list-heading" className={styles.title}>
            Agents
          </h2>
          <p className={styles.text}>Configure the agent runtimes and accounts available to this project.</p>
          <p className={styles.text}>The default agent runs a command when its routing rule does not pick an agent.</p>
        </div>
        {!readOnly && state !== 'empty' && addAgent}
      </header>
      <div className={styles.scroll} role="region" aria-label="Agents list" tabIndex={0}>
        {lead}
        {state === 'loading' && (
          <div role="status" aria-label="Loading agents" aria-busy="true">
            <ul className={styles.rows}>
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <li key={i} className={styles.skeletonRow}>
                  <Skeleton variant="block" width={32} height={32} />
                  <Skeleton variant="text" lines={2} width="60%" />
                </li>
              ))}
            </ul>
          </div>
        )}
        {state === 'error' && (
          <Banner
            tone="err"
            icon={<Icon name="warning" size={16} />}
            live="assertive"
            actions={<Button onClick={onRetry}>Retry</Button>}
          >
            <span>Could not load the agents. Try again.</span>
            {error?.requestId && <span className={styles.request}>Request ID: {error.requestId}</span>}
          </Banner>
        )}
        {state === 'empty' && (
          <EmptyState
            title="No agents yet"
            body="Add an agent so a routing rule has something to run. The first one you add becomes the project default."
            action={readOnly ? undefined : addAgent}
          />
        )}
        {state === 'ready' && (
          <ul className={styles.rows}>
            {rows.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                onEdit={onEdit}
                onTest={onTest}
                onSetDefault={onSetDefault}
                onDelete={onDelete}
                busy={busyId === agent.id}
                testing={testingId === agent.id}
                readOnly={readOnly}
                onlyAgent={pagination.total === 1}
              />
            ))}
          </ul>
        )}
      </div>
      {state === 'ready' && <Pagination {...pagination} />}
    </section>
  );
}
