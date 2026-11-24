import { useId, useState } from 'react';
import { Button } from '@/ds';
import type { RunUsageView } from '@/mocks/types';
import { Note } from './RunFacts';
import { Section } from './Section';
import styles from './RunUsage.module.css';
import sideStyles from './SidePanel.module.css';

export interface RunUsageProps {
  usage: RunUsageView;
  /** Start with the section open (default) or collapsed. */
  initialOpen?: boolean;
  /** Start with the Models table open (default) or collapsed. */
  initialModelsOpen?: boolean;
}

const ESTIMATE = 'Estimate at public API rates, whatever credential the run used.';
const FIXED = 'Costs are fixed when recorded, so later price changes do not change them.';
const BILL = 'Your provider bill may differ.';
const PARTIAL = 'Some usage is missing or had no price when recorded, so tokens or cost may be low.';

function Toggle({ open, controls, onToggle }: { open: boolean; controls: string; onToggle(): void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      iconRight={open ? 'chevron-down' : 'chevron-right'}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? 'Hide' : 'Show'}
    </Button>
  );
}

/** Side panel section with a run's token usage, estimated cost and the models it used. Collapsible. */
export function RunUsage({ usage, initialOpen = true, initialModelsOpen = true }: RunUsageProps) {
  const [open, setOpen] = useState(initialOpen);
  const [modelsOpen, setModelsOpen] = useState(initialModelsOpen);
  const bodyId = useId();
  const tableId = useId();

  if (usage.state === 'none') {
    return (
      <Section title="Usage">
        <Note tone="faint" size={13}>
          No usage data for this run.
        </Note>
      </Section>
    );
  }

  const note = [ESTIMATE, FIXED, ...(usage.priceDate ? [`Prices as of ${usage.priceDate}.`] : []), BILL].join(' ');
  return (
    <Section title="Usage" aside={<Toggle open={open} controls={bodyId} onToggle={() => setOpen((o) => !o)} />}>
      <div id={bodyId} className={styles.body} role="region" aria-label="Usage" hidden={!open}>
        <dl className={styles.split}>
          <div className={styles.total}>
            <dt>
              Total tokens <span className={`faint ${styles.hint}`}>all tokens processed</span>
            </dt>
            <dd className="num">{usage.total}</dd>
          </div>
          <div>
            <dt>Input (uncached)</dt>
            <dd className="num">{usage.input}</dd>
          </div>
          <div>
            <dt>Cache read</dt>
            <dd className="num">{usage.cacheRead}</dd>
          </div>
          <div>
            <dt>Cache write</dt>
            <dd className="num">{usage.cacheWrite}</dd>
          </div>
          <div>
            <dt>Output</dt>
            <dd className="num">{usage.output}</dd>
            {usage.reasoning !== undefined && (
              <dd className={`faint ${styles.reasoning}`}>
                <span>of which reasoning</span>
                <span className="num">{usage.reasoning}</span>
              </dd>
            )}
          </div>
          <div className={styles.cost}>
            <dt>Est. cost</dt>
            <dd className="num">
              {usage.atLeast && <span className={styles.atLeast}>at least </span>}
              {usage.cost}
            </dd>
          </div>
        </dl>
        <Note>{note}</Note>
        {usage.partial && <Note>{PARTIAL}</Note>}
        <div className={`${sideStyles['sec-h']} ${styles['models-h']}`}>
          <span>Models</span>
          <Toggle open={modelsOpen} controls={tableId} onToggle={() => setModelsOpen((o) => !o)} />
        </div>
        <table id={tableId} className={styles.table} hidden={!modelsOpen}>
          <caption className="sr-only">Usage by model</caption>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col" className={styles.tokens}>
                Tokens
              </th>
              <th scope="col" className={styles.costCol}>
                Est. cost
              </th>
            </tr>
          </thead>
          <tbody>
            {usage.models.map((m, i) => (
              <tr key={`${i}:${m.name}`}>
                <th scope="row" title={m.name}>
                  {m.name}
                </th>
                <td className="num">{m.tokens}</td>
                <td className="num">
                  {m.unpriced ? (
                    <span className="faint" title="No price when this was recorded">
                      {m.cost}
                    </span>
                  ) : (
                    m.cost
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
