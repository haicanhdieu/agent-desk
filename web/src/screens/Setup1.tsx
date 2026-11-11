import { useState } from 'react';
import { Banner, Field, Icon, InlineStatus, RadioCard, StatusIcon, TextInput } from '@/ds';
import { KeyValue, SetupLayout } from '@/components';
import type { Actor } from '@/mocks/types';
import { setupSteps, type SetupNav } from './setupSteps';
import styles from './Screens.module.css';

export interface Setup1Props extends SetupNav {
  user: Actor;
  projectName: string;
  repos: { name: string; meta: string }[];
  selected: string;
  installedOn: string;
  pingAt?: string;
  accessHref?: string;
}

const permissions = [
  { term: 'Contents', value: 'Read and write' },
  { term: 'Issues', value: 'Read and write' },
  { term: 'Pull requests', value: 'Read and write' },
  { term: 'Metadata', value: 'Read' },
  { term: 'Events', value: 'Issue comment' },
];

export function Setup1({ user, projectName, repos, selected, installedOn, pingAt, nextHref = '#', accessHref = 'https://github.com/' }: Setup1Props) {
  const [repo, setRepo] = useState(selected);
  return (
    <SetupLayout
      user={user}
      projectName={projectName}
      steps={setupSteps()}
      current={0}
      stepLabel="Step 1 of 4"
      title="Connect a repository"
      intro="The Agent Desk GitHub App receives issue comments and gives each run a one-hour token for this repository only."
      footer={{ next: { label: 'Continue', href: nextHref } }}
      aside={
        <div className={styles.stack14}>
          <h2 className="h3">Permissions the app asks for</h2>
          <KeyValue items={permissions} termWidth={120} />
          <div className={styles.asideBanner}>
            <Banner tone="warn" icon={<Icon name="warning" size={16} />} title="If the ping does not arrive">
              On a local cluster GitHub cannot reach you. Start the webhook relay and press <a href="#">Check again</a>. Until then this step shows "Waiting for webhook ping".
            </Banner>
          </div>
        </div>
      }
    >
      <Field label="Project name">
        {({ id }) => <TextInput id={id} defaultValue={projectName} />}
      </Field>
      <div className={styles.stack10}>
        <div className={styles.split}>
          <span className={styles.groupLabel}>GitHub App installation</span>
          <InlineStatus tone="ok" icon={<StatusIcon status="succeeded" size={12} />}>Installed on {installedOn}</InlineStatus>
        </div>
        <div className={styles.stack8} role="radiogroup" aria-label="Repository">
          {repos.map((r) => (
            <RadioCard
              key={r.name}
              type="radio"
              name="repo"
              checked={r.name === repo}
              onChange={() => setRepo(r.name)}
              title={<span className="mono">{r.name}</span>}
              description={r.meta}
              faintDescription
            />
          ))}
        </div>
        <p className={`muted ${styles.helpLine}`}>
          Missing a repository? <a href={accessHref}>Change which repositories the app can access</a> in GitHub, then come back. This list refreshes on its own.
        </p>
      </div>
      {pingAt && (
        <Banner tone="ok" icon={<StatusIcon status="succeeded" size={16} />} title={`Webhook ping received at ${pingAt}`}>
          GitHub can reach Agent Desk. Comments on this repository will arrive within seconds.
        </Banner>
      )}
    </SetupLayout>
  );
}
