import { AppLink, Button } from '@/ds';
import styles from './Composites.module.css';

export interface SkillListProps {
  skills: { name: string; description: string; ruleSummary: string; href?: string }[];
  activeName?: string;
  branch: string;
  onNew?(): void;
  /** Called on a plain click of a skill; the link's own navigation is then skipped. */
  onSelect?(name: string): void;
}

export function SkillList({ skills, activeName, branch, onNew, onSelect }: SkillListProps) {
  return (
    <nav className={styles.skills} aria-label="Skills">
      <div className={styles.skillsHead}>
        <h2>Skills</h2>
        <Button size="sm" icon="plus" onClick={onNew}>
          New skill
        </Button>
      </div>
      <p className={styles.skillsPath}>.claude/skills/ on {branch}</p>
      <ul className={styles.skillItems}>
        {skills.map((s) => {
          const active = s.name === activeName;
          return (
            <li key={s.name}>
              <AppLink
                href={s.href ?? `#${s.name}`}
                className={[styles.skill, active && styles.active].filter(Boolean).join(' ')}
                aria-current={active ? 'page' : undefined}
                onClick={
                  onSelect &&
                  ((e) => {
                    // Modified clicks (new tab, new window) keep the link's default.
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    onSelect(s.name);
                  })
                }
              >
                <span className={styles.skillTop}>
                  <b className={styles.skillName}>{s.name}</b>
                  <span className={styles.skillRules}>{s.ruleSummary}</span>
                </span>
                <span className={styles.skillDesc}>{s.description}</span>
              </AppLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
