import { providerLogos } from '@/ds/providerLogos';
import styles from './ProviderMark.module.css';

export interface ProviderMarkProps {
  /** The provider's logo key (`logo` in the contracts capability table). */
  kind: string;
  /** The provider's name; its first letter is the fallback when there is no mark. */
  label: string;
  size: 'sm' | 'md' | 'lg';
  /** `text` for a provider you can pick, `muted` for a Coming soon one. */
  tint?: 'text' | 'muted';
}

/**
 * The provider's mark in a small tile. It is decorative: the name always sits next to it as text, so the tile adds no
 * accessible name. A kind with no mark shows the uppercase first letter of the label in the same tile.
 */
export function ProviderMark({ kind, label, size, tint = 'text' }: ProviderMarkProps) {
  const logo = Object.hasOwn(providerLogos, kind) ? providerLogos[kind] : undefined;
  const classes = `${styles.tile} ${styles[size]} ${styles[tint]}`;
  if (!logo) {
    return (
      <span className={classes} aria-hidden="true">
        {label.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={classes}>
      <svg aria-hidden="true" focusable="false" viewBox={logo.viewBox} fill="currentColor" className={styles.logo}>
        {logo.paths.map((d) => (
          <path key={d} d={d} fillRule="evenodd" />
        ))}
      </svg>
    </span>
  );
}
