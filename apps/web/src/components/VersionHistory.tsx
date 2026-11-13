import { Button, Skeleton } from '@/ds';
import styles from './WorkspaceSetup.module.css';

export interface ScriptVersion {
  version: number;
  author: string;
  /** Display time, e.g. "2 days ago". */
  ago: string;
  note?: string;
}

export interface VersionHistoryProps {
  /** Newest first. The first entry is the current version. */
  versions: ScriptVersion[];
  loading?: boolean;
  error?: string;
  onView?(version: number): void;
  /** Writes a new version with this version's body; history stays append-only. */
  onRestore?(version: number): void;
}

export function VersionHistory({ versions, loading, error, onView, onRestore }: VersionHistoryProps) {
  if (loading)
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading versions</span>
        <Skeleton variant="text" lines={4} />
      </div>
    );
  if (error) return <p className={styles.listNote}>{error}</p>;
  if (versions.length === 0)
    return <p className={styles.listNote}>No versions yet. The first save creates version 1.</p>;
  return (
    <ol className={styles.versions} aria-label="Setup script versions">
      {versions.map((v, i) => {
        const current = i === 0;
        return (
          <li
            key={v.version}
            className={[styles.version, current && styles.current].filter(Boolean).join(' ')}
            aria-current={current || undefined}
          >
            <span className={styles.versionNum}>v{v.version}</span>
            <span className={styles.versionText}>
              <span className={styles.versionNote}>{v.note ?? <span className={styles.faint}>No note</span>}</span>
              <span className={styles.versionMeta}>
                {v.author}, {v.ago}
                {current && ' · current'}
              </span>
            </span>
            {!current && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onView?.(v.version)}
                  aria-label={`View version ${v.version}`}
                >
                  View
                </Button>
                <Button size="sm" onClick={() => onRestore?.(v.version)} aria-label={`Restore version ${v.version}`}>
                  Restore
                </Button>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
