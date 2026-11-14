import type { ReactNode } from 'react';
import { Button } from '@/ds';
import styles from './Composites.module.css';

export function CodeBlock({ caption, code, onCopy }: { caption: ReactNode; code: string; onCopy?(): void }) {
  return (
    <div className={styles.code}>
      <div className={styles.codeCap}>
        <span>{caption}</span>
        <Button size="sm" icon="copy" onClick={onCopy}>
          Copy
        </Button>
      </div>
      <pre className={styles.codePre}>{code}</pre>
    </div>
  );
}
