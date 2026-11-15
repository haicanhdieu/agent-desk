import { useId, useState } from 'react';
import { Button } from '@/ds';
import styles from './SidePanel.module.css';

export interface RunPromptSectionProps {
  /** The prompt the run started with, known secrets redacted; `null` for runs started before prompts were recorded. */
  finalPrompt: string | null;
  /** Start expanded (the board that shows the prompt). */
  defaultOpen?: boolean;
}

/** Side panel section with the final prompt of a run, collapsed by default. */
export function RunPromptSection({ finalPrompt, defaultOpen = false }: RunPromptSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const recorded = finalPrompt !== null;
  return (
    <section className={styles.sec}>
      <div className={styles['sec-h']}>
        <span>Prompt</span>
        {recorded ? (
          <Button
            variant="ghost"
            size="sm"
            iconRight={open ? 'chevron-down' : 'chevron-right'}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? 'Hide' : 'Show'}
          </Button>
        ) : (
          <span className="faint">Not recorded</span>
        )}
      </div>
      {recorded && (
        <pre id={bodyId} className={styles.prompt} hidden={!open} tabIndex={0} role="region" aria-label="Final prompt">
          {finalPrompt}
        </pre>
      )}
    </section>
  );
}
