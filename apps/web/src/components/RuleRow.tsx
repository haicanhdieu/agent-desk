import { useEffect, useRef, useState } from 'react';
import { Button, Icon, IconButton, InlineStatus, Popover, Toggle } from '@/ds';
import { RuleSentence, type RuleDraft } from './RuleSentence';
import styles from './Composites.module.css';

export interface RuleRowProps {
  rule: RuleDraft & { id: string };
  stats: string;
  warning?: string;
  selected?: boolean;
  onToggle(next: boolean): void;
  /** Opens the rule; also the menu's Edit. */
  onSelect?(): void;
  /** The menu's Delete. */
  onDelete?(): void;
}

/** Where the actions menu sits: under the More button, right edges aligned, in viewport coordinates. */
interface MenuAt {
  top: number;
  right: number;
}

export function RuleRow({ rule, stats, warning, selected, onToggle, onSelect, onDelete }: RuleRowProps) {
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const open = menuAt !== null;

  // An outside press, a scroll or a resize closes the menu (it is placed in viewport coordinates, so it would drift).
  // Escape is handled by the Popover, which also returns focus to the More button.
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setMenuAt(null);
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !moreRef.current?.contains(e.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setMenuAt(null);
      return;
    }
    const r = moreRef.current?.getBoundingClientRect();
    setMenuAt({ top: (r?.bottom ?? 0) + 4, right: window.innerWidth - (r?.right ?? 0) });
  };
  const pick = (action: (() => void) | undefined) => () => {
    setMenuAt(null);
    action?.();
  };

  const sentence = (
    <span className={rule.enabled ? undefined : styles.faintText}>
      <RuleSentence rule={rule} variant="plain" />
    </span>
  );
  return (
    <div
      className={[styles.ruleRow, selected && styles.selected].filter(Boolean).join(' ')}
      aria-current={selected ? 'true' : undefined}
    >
      <Toggle aria-label={`Enable rule /${rule.command}`} checked={rule.enabled} onChange={onToggle} />
      <div className={styles.ruleBody}>
        {onSelect ? (
          <button
            type="button"
            className={styles.ruleSelect}
            aria-label={`Edit rule /${rule.command}`}
            onClick={onSelect}
          >
            {sentence}
          </button>
        ) : (
          sentence
        )}
        {warning && (
          <InlineStatus tone="idle" icon={<Icon name="warning" size={14} />}>
            {warning}
          </InlineStatus>
        )}
      </div>
      <span className={styles.stats}>{stats}</span>
      <span ref={moreRef}>
        <IconButton
          icon="more"
          aria-label={`More actions for /${rule.command}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={!onSelect && !onDelete}
          onClick={toggleMenu}
        />
        <Popover
          open={open}
          label={`Actions for /${rule.command}`}
          onClose={() => setMenuAt(null)}
          style={{ position: 'fixed', top: menuAt?.top, right: menuAt?.right, padding: 6, gap: 2 }}
        >
          {onSelect && (
            <Button variant="ghost" size="sm" className={styles.menuAction} onClick={pick(onSelect)}>
              Edit
            </Button>
          )}
          {onDelete && (
            <Button variant="danger" size="sm" icon="trash" className={styles.menuAction} onClick={pick(onDelete)}>
              Delete
            </Button>
          )}
        </Popover>
      </span>
    </div>
  );
}
