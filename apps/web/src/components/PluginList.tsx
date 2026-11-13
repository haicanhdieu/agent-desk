import { Icon, Skeleton, StatusIcon } from '@/ds';
import styles from './WorkspaceSetup.module.css';

/**
 * `will_install` / `blocked` describe the next run (derived from the repo settings and the approved stores);
 * `installed` / `skipped` / `failed` are what a run or test actually did.
 */
export type PluginState = 'will_install' | 'blocked' | 'installed' | 'skipped' | 'failed';

export interface PluginListProps {
  /** Ids as the repo writes them: `<plugin>@<marketplace>`. */
  plugins: { id: string; state: PluginState }[];
  loading?: boolean;
  /** The repo settings could not be read. */
  error?: string;
}

const copy: Record<PluginState, { text: string; tone?: 'warn' | 'err' }> = {
  will_install: { text: 'Will install' },
  blocked: { text: 'Blocked: store not approved', tone: 'warn' },
  installed: { text: 'Installed' },
  skipped: { text: 'Skipped: store not approved', tone: 'warn' },
  failed: { text: 'Install failed, the run continued without it', tone: 'err' },
};

function StateIcon({ state }: { state: PluginState }) {
  if (state === 'blocked' || state === 'skipped') {
    return (
      <span className={styles.blocked} role="img" aria-label="Blocked">
        <Icon name="ignored" size={13} />
      </span>
    );
  }
  return (
    <StatusIcon
      status={state === 'failed' ? 'failed' : 'succeeded'}
      size={12}
      title={state === 'failed' ? 'Failed' : 'OK'}
    />
  );
}

/** Plugins the repo enables in `.claude/settings.json`, with what happens to each. */
export function PluginList({ plugins, loading, error }: PluginListProps) {
  if (loading) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading plugins</span>
        <Skeleton variant="text" lines={3} />
      </div>
    );
  }
  if (error) return <p className={`${styles.listNote} ${styles.pluginState} ${styles.err}`}>{error}</p>;
  if (plugins.length === 0) {
    return (
      <p className={styles.listNote}>
        The repo enables no plugins in <span className="mono">.claude/settings.json</span>.
      </p>
    );
  }
  return (
    <ul className={styles.plugins}>
      {plugins.map(({ id, state }) => {
        const at = id.lastIndexOf('@');
        const { text, tone } = copy[state];
        return (
          <li key={id} className={styles.plugin}>
            <span className={styles.pluginIco}>
              <StateIcon state={state} />
            </span>
            <span className={styles.pluginText}>
              <span className={styles.pluginId} title={id}>
                {at > 0 ? (
                  <>
                    {id.slice(0, at)}
                    <span className={styles.pluginStore}>{id.slice(at)}</span>
                  </>
                ) : (
                  id
                )}
              </span>
              <span className={[styles.pluginState, tone && styles[tone]].filter(Boolean).join(' ')}>{text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
