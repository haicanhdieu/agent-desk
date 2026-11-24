import { EnvEntryList, type EnvEntryListProps } from '@/components';
import styles from './Screens.module.css';

export type EnvListGroup = Omit<EnvEntryListProps, 'kind'>;

export interface DeskSetupEnvironmentProps {
  variables: EnvListGroup;
  secrets: EnvListGroup;
  /** A setup test is running: it keeps the values it started with. */
  testRunning?: boolean;
}

const READ_ONLY = 'You can see these but not change them.';

/** The Environment tab body: the intro, the variables group and the secrets group. The tab strip and panel belong to `DeskSetup`. */
export function DeskSetupEnvironment({ variables, secrets, testRunning }: DeskSetupEnvironmentProps) {
  const noneWritable = !variables.canWrite && !secrets.canWrite;
  const onlySecretsReadOnly = variables.canWrite && !secrets.canWrite;
  return (
    <div className={styles.setupEnvBody}>
      <p className={`muted ${styles.setupEnvText}`}>
        Every run and setup test in this project gets these as environment variables. Runs and tests that start after
        you save use the new values. A running run keeps its old ones: stop its session and resume it to pick up the
        change.
      </p>
      {noneWritable && <p className={`faint ${styles.setupEnvText}`}>{READ_ONLY}</p>}
      {testRunning && (
        <p className={`faint ${styles.setupEnvText}`}>A test is running. It keeps the values it started with.</p>
      )}
      <section aria-labelledby="env-vars-h" className={styles.setupEnvGroup}>
        <h2 id="env-vars-h" className={styles.setupEnvTitle}>
          Environment variables
        </h2>
        <p className={`muted ${styles.setupEnvText}`}>
          Plain values are shown in full and are not hidden in logs. Put anything sensitive in Secrets.
        </p>
        <EnvEntryList
          kind="variable"
          {...variables}
          pagination={variables.pagination && { label: 'Variables pagination', ...variables.pagination }}
        />
      </section>
      <section aria-labelledby="env-secrets-h" className={styles.setupEnvGroup}>
        <h2 id="env-secrets-h" className={styles.setupEnvTitle}>
          Secrets
        </h2>
        <p className={`muted ${styles.setupEnvText}`}>
          Write-only. After you save, a value is hidden for good: you can replace or remove it, not read it back.
        </p>
        {onlySecretsReadOnly && <p className={`faint ${styles.setupEnvText}`}>{READ_ONLY}</p>}
        <p className={`faint ${styles.setupEnvText}`}>
          Setup scripts and the agent can read these values. Run output shows them as ***, but keep each secret to what
          this project needs.
        </p>
        <EnvEntryList
          kind="secret"
          {...secrets}
          pagination={secrets.pagination && { label: 'Secrets pagination', ...secrets.pagination }}
        />
      </section>
    </div>
  );
}
