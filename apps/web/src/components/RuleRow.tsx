import { Icon, IconButton, InlineStatus, Toggle } from '@/ds';
import { RuleSentence, type RuleDraft } from './RuleSentence';
import styles from './Composites.module.css';

export interface RuleRowProps {
  rule: RuleDraft & { id: string };
  stats: string;
  warning?: string;
  selected?: boolean;
  onToggle(next: boolean): void;
  onSelect?(): void;
  onMore?(): void;
}

export function RuleRow({ rule, stats, warning, selected, onToggle, onSelect, onMore }: RuleRowProps) {
  const sentence = (
    <span className={rule.enabled ? undefined : styles.faintText}>
      <RuleSentence rule={rule} variant="plain" />
    </span>
  );
  return (
    <div className={[styles.ruleRow, selected && styles.selected].filter(Boolean).join(' ')} aria-current={selected ? 'true' : undefined}>
      <Toggle aria-label={`Enable rule /${rule.command}`} checked={rule.enabled} onChange={onToggle} />
      <div className={styles.ruleBody}>
        {onSelect ? (
          <button type="button" className={styles.ruleSelect} aria-label={`Edit rule /${rule.command}`} onClick={onSelect}>{sentence}</button>
        ) : sentence}
        {warning && <InlineStatus tone="idle" icon={<Icon name="warning" size={14} />}>{warning}</InlineStatus>}
      </div>
      <span className={styles.stats}>{stats}</span>
      <IconButton icon="more" aria-label={`More actions for /${rule.command}`} onClick={onMore} />
    </div>
  );
}
